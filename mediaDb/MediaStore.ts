import * as HashStore from "../compareImg/HashStore";
import fs from "fs";

import type { MediaRow, UpsertMediaInput, MediaMissingMd5Row, DetectionBox, DetectionRow } from "../types/domain";

export const ensureReady = (): void => HashStore.ensureReady();

const MEDIA_COLUMNS = ["localPath", "filename", "mime", "kind", "size", "mtimeMs", "contentMd5", "hasAudio", "thumbPath", "updatedAt"] as const;

const MEDIA_SELECT_COLUMNS = "id, localPath, contentMd5, size, mtimeMs, hasAudio, thumbPath , mime, kind, detectionClasses, detectionAt";

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

// Records the class-name snapshot a media was just detected against, so a
// later detectObjects run can tell "already recognized with today's classes"
// (skip) apart from "recognized under a class list that has since changed"
// (redo). No-op update if the media row doesn't exist (e.g. an imported item).
export const setDetectionState = (id: string, classesSnapshot: string): void => {
    const db = HashStore.getDb();
    db.prepare("UPDATE media SET detectionClasses = ?, detectionAt = ? WHERE id = ?").run(classesSnapshot, Date.now(), id);
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

export const replaceDetections = (mediaId: string, boxes: DetectionBox[], modelPath: string | null): void => {
    const db = HashStore.getDb();
    const del = db.prepare("DELETE FROM media_detection WHERE mediaId = ?");
    const insert = db.prepare(`
        INSERT INTO media_detection (mediaId, classId, className, score, x, y, w, h, modelPath, detectedAt)
        VALUES (@mediaId, @classId, @className, @score, @x, @y, @w, @h, @modelPath, @detectedAt)
    `);
    const run = db.transaction((list: DetectionBox[]) => {
        del.run(mediaId);
        const detectedAt = Date.now();
        list.forEach((box) => insert.run({
            mediaId,
            classId: box.classId,
            className: box.className,
            score: box.score,
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            modelPath: modelPath || null,
            detectedAt,
        }));
    });
    run(boxes || []);
};

export const getDetections = (mediaId: string): DetectionRow[] => {
    const db = HashStore.getDb();
    return db.prepare("SELECT classId, className, score, x, y, w, h, modelPath FROM media_detection WHERE mediaId = ?").all(mediaId) as DetectionRow[];
};

export interface DetectionRowWithMediaId extends DetectionRow {
    mediaId: string;
}

// Every stored detection for the folder's index.db in one pass - index.db is
// per-folder, so "all rows" is exactly the media the renderer has loaded.
// Ordered by mediaId so app.js can group with a single linear scan.
export const getAllDetections = (): DetectionRowWithMediaId[] => {
    const db = HashStore.getDb();
    return db.prepare(
        "SELECT mediaId, classId, className, score, x, y, w, h, modelPath FROM media_detection ORDER BY mediaId"
    ).all() as DetectionRowWithMediaId[];
};
