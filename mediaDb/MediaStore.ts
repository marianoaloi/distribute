import * as HashStore from "../compareImg/HashStore";
import fs from "fs";
import path from "path";

import type { MediaRow, UpsertMediaInput, MediaMissingMd5Row, DetectionBox, DetectionRow, DetectMediaRef } from "../types/domain";
import { getCacheDir } from "../thumbnails/cache";

export const ensureReady = (): void => HashStore.ensureReady();

const MEDIA_COLUMNS = ["localPath", "filename", "mime", "kind", "size", "mtimeMs", "contentMd5", "hasAudio", "thumbPath", "updatedAt"] as const;

const MEDIA_SELECT_COLUMNS = "id, localPath, contentMd5, size, mtimeMs, hasAudio, thumbPath , mime, kind";

// Callers (util.js's transformDataStreaming) re-upsert every media row on
// every folder load without knowing the backfilled contentMd5, so a plain
// `contentMd5 = excluded.contentMd5` would null out an already-hashed file
// on its very next load - undoing the backfill and making it re-hash every
// file, every open, forever. Only clear it when the file actually changed
// under the same path (size or mtime differs); otherwise keep whatever is
// already stored, and still let an explicit non-null value through so
// setContentMd5 callers (the backfill itself) aren't second-guessed.
export const upsertMedia = (row: UpsertMediaInput): void => {
    const db = HashStore.getDb();
    const columns = ["id", ...MEDIA_COLUMNS];
    const assignments = MEDIA_COLUMNS.map((c) => {
        if (c !== "contentMd5") return `${c} = excluded.${c}`;
        return `contentMd5 = CASE
            WHEN excluded.contentMd5 IS NOT NULL THEN excluded.contentMd5
            WHEN media.size <> excluded.size OR media.mtimeMs <> excluded.mtimeMs THEN NULL
            ELSE media.contentMd5
        END`;
    }).join(", ");
    const stmt = db.prepare(`
        INSERT INTO media (${columns.join(", ")}) VALUES (${columns.map((c) => `@${c}`).join(", ")})
        ON CONFLICT(id) DO UPDATE SET ${assignments}
    `);
    stmt.run({
        mime: null,
        contentMd5: null,
        thumbPath: null,
        updatedAt: Date.now(),
        ...row,
        hasAudio: row.hasAudio ? 1 : 0,
    });
};

export const setContentMd5 = (id: string, contentMd5: string): void => {
    const db = HashStore.getDb();
    db.prepare("UPDATE media SET contentMd5 = ?, updatedAt = ? WHERE id = ?").run(contentMd5, Date.now(), id);
};

export const setThumbPath = (id: string, thumbPath: string): void => {
    const db = HashStore.getDb();
    db.prepare("UPDATE media SET thumbPath = ?, updatedAt = ? WHERE id = ?").run(thumbPath, Date.now(), id);
};

// SQLite's default SQLITE_MAX_VARIABLE_NUMBER is 999, so ids are looked up in
// chunks. The only string interpolation is the placeholder list, built purely
// from chunk.length - every id value itself is bound, never concatenated.
const ID_CHUNK = 400;

export const findMediaByIds = (ids: string[]): Map<string, MediaRow> => {
    const db = HashStore.getDb();
    const result = new Map<string, MediaRow>();
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const chunk = ids.slice(i, i + ID_CHUNK);
        if (chunk.length === 0) continue;
        const placeholders = chunk.map(() => "?").join(",");
        const rows = db.prepare(
            `SELECT ${MEDIA_SELECT_COLUMNS} FROM media WHERE id IN (${placeholders})`
        ).all(...chunk) as MediaRow[];
        for (const row of rows) result.set(row.id, row);
    }
    return result;
};

export const findAllMediaThatExists = (): MediaRow[] => {
    const db = HashStore.getDb();
    return (db.prepare(`SELECT ${MEDIA_SELECT_COLUMNS} FROM media`).all() as MediaRow[])
        .filter(row => fs.existsSync(row.localPath));
};

export const findAllItemsExists = (): DetectMediaRef[] => {
    const db = HashStore.getDb();
    return db.prepare(`select
                    m.id as idMedia,
                    m.kind ,
                    i.id  as idItem,
                    m.localPath 
                from
                    media m
                left join media_item mi on
                    m.id = mi.mediaId
                left join items i on
                    i.id = mi.itemId`)
                    .all()
            .map((row : any) => {
                return { id: row.idMedia, media: row.kind === "image" ? row.localPath : path.join(getCacheDir(),`${row.idItem}.jpg`) } as DetectMediaRef;
            })
        .filter(row => fs.existsSync(row.media));
}

export const mediaMissingContentMd5 = (limit: number): MediaMissingMd5Row[] => {
    const db = HashStore.getDb();
    return db.prepare("SELECT id, localPath, kind FROM media WHERE contentMd5 IS NULL LIMIT ?").all(limit) as MediaMissingMd5Row[];
};

export const getDetectionClasses = (): string[] => {
    const db = HashStore.getDb();
    return (db.prepare("SELECT name FROM detection_class ORDER BY classId ASC").all() as Array<{ name: string }>).map((r) => r.name);
};

export const saveDetectionClasses = (names: string[]): void => {
    const db = HashStore.getDb();
    const del = db.prepare("DELETE FROM detection_class");
    const insert = db.prepare("INSERT INTO detection_class (classId, name, updatedAt) VALUES (?, ?, ?)");
    const run = db.transaction((list: string[]) => {
        del.run();
        const now = Date.now();
        list.forEach((name, classId) => insert.run(classId, name, now));
    });
    run(names);
};

// Mirrors setDetectionState above, one level down: records the class-name
// snapshot THIS item (not the whole media) was just detected against - see
// mediaSchema.js's item_detection_state table.
export const setItemDetectionState = (itemId: string, classesSnapshot: string): void => {
    const db = HashStore.getDb();
    db.prepare(`
        INSERT INTO item_detection_state (itemId, detectionClasses, detectionAt) VALUES (@itemId, @classesSnapshot, @detectedAt)
        ON CONFLICT(itemId) DO UPDATE SET detectionClasses = excluded.detectionClasses, detectionAt = excluded.detectionAt
    `).run({ itemId, classesSnapshot, detectedAt: Date.now() });
};

export interface ItemDetectionState {
    detectionClasses: string | null;
    detectionAt: number | null;
}

// Bulk lookup (same chunking rationale as findMediaByIds above - SQLite's
// default SQLITE_MAX_VARIABLE_NUMBER is 999) so detectObjects can decide,
// per item, whether to skip re-running the model on it.
export const findItemsDetectionState = (ids: string[]): Map<string, ItemDetectionState> => {
    const db = HashStore.getDb();
    const result = new Map<string, ItemDetectionState>();
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const chunk = ids.slice(i, i + ID_CHUNK);
        if (chunk.length === 0) continue;
        const placeholders = chunk.map(() => "?").join(",");
        const rows = db.prepare(
            `SELECT itemId, detectionClasses, detectionAt FROM item_detection_state WHERE itemId IN (${placeholders})`
        ).all(...chunk) as Array<{ itemId: string; detectionClasses: string | null; detectionAt: number | null }>;
        for (const row of rows) result.set(row.itemId, { detectionClasses: row.detectionClasses, detectionAt: row.detectionAt });
    }
    return result;
};

// Upserts the row for this model path (one row per distinct path ever
// chosen - see mediaSchema.js's model_path table) and returns its id, so
// item_detection can reference *which* model produced a result without
// repeating the path text on every row.
export const getOrCreateModelPath = (path: string): number => {
    const db = HashStore.getDb();
    const row = db.prepare(`
        INSERT INTO model_path (path, updatedAt) VALUES (@path, @updatedAt)
        ON CONFLICT(path) DO UPDATE SET updatedAt = excluded.updatedAt
        RETURNING id
    `).get({ path, updatedAt: Date.now() }) as { id: number };
    return row.id;
};

// Detection now runs per item (an image's 1 item, or a video/GIF's up to 4
// frame items - see app.js's detectObjects), not per media - className is
// intentionally not stored, it's joined from detection_class at read time.
export const replaceItemDetections = (itemId: string, boxes: DetectionBox[], modelPathId: number | null): void => {
    const db = HashStore.getDb();
    const del = db.prepare("DELETE FROM item_detection WHERE itemId = ?");
    const insert = db.prepare(`
        INSERT INTO item_detection (itemId, classId, score, x, y, w, h, modelPathId, detectedAt)
        VALUES (@itemId, @classId, @score, @x, @y, @w, @h, @modelPathId, @detectedAt)
    `);
    const run = db.transaction((list: DetectionBox[]) => {
        del.run(itemId);
        const detectedAt = Date.now();
        list.forEach((box) => insert.run({
            itemId,
            classId: box.classId,
            score: box.score,
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            modelPathId: modelPathId ?? null,
            detectedAt,
        }));
    });
    run(boxes || []);
};

const ITEM_DETECTION_SELECT = `
    SELECT item_detection.classId AS classId, detection_class.name AS className,
           item_detection.score AS score, item_detection.x AS x, item_detection.y AS y,
           item_detection.w AS w, item_detection.h AS h, model_path.path AS modelPath
    FROM item_detection
    LEFT JOIN detection_class ON detection_class.classId = item_detection.classId
    LEFT JOIN model_path ON model_path.id = item_detection.modelPathId
    WHERE item_detection.itemId = ?
`;

export const getItemDetections = (itemId: string): DetectionRow[] => {
    const db = HashStore.getDb();
    return db.prepare(ITEM_DETECTION_SELECT).all(itemId) as DetectionRow[];
};

export interface DetectionRowWithMediaId extends DetectionRow {
    mediaId: string;
}

// Boxes for on-screen overlay: only the single "display item" per media (the
// sole item for an image, the end10s frame item for a video/GIF - the one
// whose pixels the grid actually shows as the thumbnail), so x/y/w/h stay
// spatially valid against the displayed image. items.framePosition is '' for
// an image's item and 'end10s' for that one video/GIF frame - mutually
// exclusive per media, so this single WHERE picks exactly one item per media
// with no extra grouping needed. Ordered by mediaId so app.js can group with
// a single linear scan.
export const getAllDisplayDetections = (): DetectionRowWithMediaId[] => {
    const db = HashStore.getDb();
    return db.prepare(`
        SELECT media_item.mediaId AS mediaId, item_detection.classId AS classId,
               detection_class.name AS className, item_detection.score AS score,
               item_detection.x AS x, item_detection.y AS y, item_detection.w AS w, item_detection.h AS h,
               model_path.path AS modelPath
        FROM media_item
        JOIN items ON items.id = media_item.itemId
        JOIN item_detection ON item_detection.itemId = items.id
        LEFT JOIN detection_class ON detection_class.classId = item_detection.classId
        LEFT JOIN model_path ON model_path.id = item_detection.modelPathId
        WHERE items.framePosition IN ('', 'end10s')
        ORDER BY media_item.mediaId
    `).all() as DetectionRowWithMediaId[];
};

// Filtering (classFilter.tsx/gridImg.tsx) only needs "does this media contain
// class X anywhere", so - unlike the display boxes above - it uses the union
// of classes across EVERY item linked to a media (all 4 frames for a video/
// GIF, not just the thumbnail one). DISTINCT collapses the same class
// detected in multiple frames/boxes into one entry per media.
export const getDetectionClassesByMedia = (): Array<{ mediaId: string; className: string }> => {
    const db = HashStore.getDb();
    return db.prepare(`
        SELECT DISTINCT media_item.mediaId AS mediaId, detection_class.name AS className
        FROM media_item
        JOIN item_detection ON item_detection.itemId = media_item.itemId
        LEFT JOIN detection_class ON detection_class.classId = item_detection.classId
        WHERE detection_class.name IS NOT NULL
    `).all() as Array<{ mediaId: string; className: string }>;
};
