import fs from "fs";
import crypto from "crypto";
import Database from "better-sqlite3";
import { getDbDir, getDbPath } from "./cache";
import { createMediaSchema } from "../mediaDb/mediaSchema";
import { blurMd5For } from "./pixelHash";

// baseGrey (the raw cropped/greyscale pixel buffer) has no index:
// duplicateFinder.js compares it by pixel distance, not SQL equality, so
// there's no equality/range lookup to index - see allBaseGreyRows below.
//
// Deliberately NOT coupled to imageTransform.js's BLUR_LEVELS/SQUARE_SIZE
// constants (unlike the old blur_1..blur_N columns were): those are tuned
// often while iterating on crop/blur (see git history), and because
// CREATE TABLE IF NOT EXISTS is a no-op on an already-existing table, any
// schema built from the *current* BLUR_LEVELS would drift out of sync with
// whatever columns actually exist on disk from a previous run's config -
// exactly the "no such column: blur_2" crash this replaced. A fixed schema
// can't drift.
const METADATA_COLUMNS = ["framePosition", "framePositionSeconds", "baseMd5", "baseGrey", "baseMd5Blur"] as const;

export interface ItemRow {
    id: string;
    framePosition: string;
    /** Frame's timestamp within the source video/GIF, in seconds (fractional). Null for images. */
    framePositionSeconds: number | null;
    baseMd5: string | null;
    baseGrey: Buffer | null;
    /** Coarse bucketing key derived from baseGrey - see pixelHash.ts's blurMd5For. */
    baseMd5Blur: string | null;
}

export interface MediaItemRow {
    itemId: string;
    framePosition: string;
}

export interface UpsertItemInput {
    id: string;
    metadata: {
        framePosition: string;
        framePositionSeconds: number | null;
        baseMd5: string;
        baseGrey: Buffer;
        baseMd5Blur: string;
    };
}

export interface BaseGreyRow {
    mediaId: string;
    baseGrey: Buffer;
    localPath: string;
    contentMd5: string | null;
    baseMd5: string | null;
    baseMd5Blur: string | null;
}

interface SavedDetectionClass {
    classId: number;
    name: string;
    updatedAt: number;
}

let db: Database.Database | null = null;

// Adds a column to an already-created table if it predates this schema
// version. CREATE TABLE IF NOT EXISTS is a no-op on an existing table, so
// this is the only way an existing installation's index.db picks up new
// columns without the user losing their whole index.
const ensureColumn = (database: Database.Database, table: string, name: string, type: string): void => {
    const columns = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (!columns.some((c) => c.name === name)) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
};

// The mirror of ensureColumn, for a column this schema has since dropped.
// Actually dropping it (rather than leaving it as a dead column) matters
// because dbImport.ts compares an exported database's `items` layout against
// the live one - a leftover column here would make every freshly exported
// database look structurally different from a rebuilt one.
const dropColumn = (database: Database.Database, table: string, name: string): void => {
    const columns = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (columns.some((c) => c.name === name)) {
        database.exec(`ALTER TABLE ${table} DROP COLUMN ${name}`);
    }
};

const createSchema = (database: Database.Database): void => {
    // Item ids are media.contentMd5 concatenated with media.id (plus a
    // _framePosition suffix for video/GIF frames - see mediaIndexer.js), so
    // each media owns its own item(s) rather than sharing one item id across
    // every media with byte-identical content. One media still has many
    // items (its up to-4 frames), resolved through the media_item join table
    // below rather than a mediaId column on items (a single column can only
    // ever point at the last media that indexed that content, silently
    // dropping every earlier duplicate's membership). localPath and kind
    // live on the related media row - join through media_item instead of
    // duplicating them here.
    database.exec(`
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            framePosition TEXT NOT NULL DEFAULT '',
            framePositionSeconds REAL,
            baseMd5 TEXT,
            baseGrey BLOB,
            baseMd5Blur TEXT
        );
    `);
    ensureColumn(database, "items", "baseGrey", "BLOB");
    ensureColumn(database, "items", "framePositionSeconds", "REAL");
    ensureColumn(database, "items", "baseMd5Blur", "TEXT");
    // Moved to media.futurePosition (mediaDb/mediaSchema.ts). Here it was a
    // permanently -1 INTEGER nothing ever read - the destination of a move
    // belongs to the media that moved, not to a per-frame content fingerprint.
    dropColumn(database, "items", "futurePosition");
    database.exec("CREATE INDEX IF NOT EXISTS idx_items_baseMd5 ON items(baseMd5);");
    database.exec("CREATE INDEX IF NOT EXISTS idx_items_baseMd5Blur ON items(baseMd5Blur);");

    // Logical FKs (no declared REFERENCES), same pattern as
    // media_detection.mediaId in mediaSchema.js.
    database.exec(`
        CREATE TABLE IF NOT EXISTS media_item (
            mediaId TEXT NOT NULL,
            itemId  TEXT NOT NULL,
            PRIMARY KEY (mediaId, itemId)
        );
    `);
    database.exec("CREATE INDEX IF NOT EXISTS idx_media_item_itemId ON media_item(itemId);");

    // Persisted result of duplicateFinder.js's O(n^2) pixel-comparison scan -
    // that scan is slow enough (whole-library pairwise compare) that losing
    // it on every app restart/DB reopen would mean re-running it just to see
    // the same groups again. One row per (group, media) membership rather
    // than a JSON blob column so a single media's groups are a plain indexed
    // lookup. Logical FK to media.id, same pattern as media_item.mediaId.
    // Wiped and fully rewritten each time a scan finishes (see
    // replaceDuplicateGroups) since the scan result is a complete snapshot
    // of the whole library, not an incremental delta.
    database.exec(`
        CREATE TABLE IF NOT EXISTS items_duplicated (
            groupId TEXT NOT NULL,
            mediaId TEXT NOT NULL,
            PRIMARY KEY (groupId, mediaId)
        );
    `);
    database.exec("CREATE INDEX IF NOT EXISTS idx_items_duplicated_mediaId ON items_duplicated(mediaId);");

    dropFingerprintsFromOlderAlgorithm(database);
    backfillBlurKeys(database);

    createMediaSchema(database);
};

// items.baseMd5Blur is pure derived data (a function of baseGrey alone), so
// rows indexed before the column existed do not need the media re-decoded
// through ffmpeg - just the sub-millisecond blur/quantise step over the
// pixels already stored. Without this, mediaIndexer's "already have this
// item, skip it" check would leave every pre-existing row NULL forever and
// duplicateFinder would silently exclude them from the grouped scan.
// Idempotent: only NULL rows are touched, so a healthy index costs one
// SELECT that returns nothing.
const backfillBlurKeys = (database: Database.Database): void => {
    const rows = database
        .prepare("SELECT id, baseGrey FROM items WHERE baseMd5Blur IS NULL AND baseGrey IS NOT NULL")
        .all() as Array<{ id: string; baseGrey: Buffer }>;
    if (rows.length === 0) return;
    console.log(`compareImg: computing baseMd5Blur for ${rows.length} existing item fingerprints`);
    const update = database.prepare("UPDATE items SET baseMd5Blur = ? WHERE id = ?");
    database.transaction((rows: Array<{ id: string; baseGrey: Buffer }>): void => {
        for (const row of rows) {
            try {
                update.run(blurMd5For(row.baseGrey), row.id);
            } catch (error) {
                // A baseGrey of the wrong length is a row from an older
                // geometry that dropFingerprintsFromOlderAlgorithm should
                // already have cleared; leave it NULL rather than abort.
                console.error(`compareImg: cannot derive baseMd5Blur for item ${row.id}:`, (error as Error).message);
            }
        }
    })(rows);
};

// baseMd5/baseGrey are only meaningful against values produced by the SAME
// fingerprint algorithm: both the exact-match (baseMd5 equality) and the
// near-match (mean pixel difference vs MEAN_DIFF_THRESHOLD) comparisons
// assume every row was computed the same way. Mixing generations does not
// fail loudly - it silently reports wrong duplicates, which is worse.
//
// Bump this whenever anything that changes the produced pixels changes:
// decoder, scale geometry, resampling filter, greyscale formula.
//   1 - Jimp: full-resolution RGBA decode, bilinear squash to 48x48,
//       crop to 40x40, Rec.709 greyscale; baseMd5 over the 40x40 RGBA.
//   2 - ffmpeg (compareImg/pixelHash.ts): scale=48:48:flags=area, crop to
//       40x40, format=gray; baseMd5 over the 1600 grey bytes.
// Measured mean difference between 1 and 2 on identical input is ~48,
// against a match threshold of 3 - so v1 rows are not merely imprecise
// here, they are noise, and every one of them has to be recomputed.
const FINGERPRINT_VERSION = 2;

// Clears fingerprints written by an older algorithm so mediaIndexer's
// "already have this item, skip it" check re-computes them. Deliberately
// only touches derived data: items rows are rebuilt from the media files on
// the next index, and items_duplicated is a full snapshot that
// replaceDuplicateGroups rewrites wholesale, so nothing the user cannot
// regenerate is lost. media_item survives untouched - linkItemMedia is
// idempotent, so re-indexing simply re-establishes the same links.
const dropFingerprintsFromOlderAlgorithm = (database: Database.Database): void => {
    const stored = database.pragma("user_version", { simple: true }) as number;
    if (stored === FINGERPRINT_VERSION) return;

    const stale = (database.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n;
    if (stale > 0) {
        console.log(`compareImg: fingerprint algorithm v${stored} -> v${FINGERPRINT_VERSION}, discarding ${stale} stale item fingerprints for re-indexing`);
        database.exec("DELETE FROM items;");
        database.exec("DELETE FROM items_duplicated;");
    }
    database.pragma(`user_version = ${FINGERPRINT_VERSION}`);
};

const openDb = (): Database.Database => {
    fs.mkdirSync(getDbDir(), { recursive: true });
    return new Database(getDbPath());
};


// Closes the current connection without deleting anything, so the next
// ensureReady() call re-opens against whatever folder is active - used when
// the user switches to a different folder (its own tmp/hashIndex/index.db).
export const closeConnection = (): void => {
    if (db) {
        db.close();
        db = null;
    }
};

const verifyIntegrity = (): void => {
    try {
        const result = db!.pragma("integrity_check", { simple: true });
        if (result !== "ok") throw new Error(String(result));
    } catch (error) {
        console.error("compareImg: index corrupted, rebuilding:", (error as Error).message);
    }
};

export const ensureReady = (): void => {
    if (db) return;
    db = openDb();
    createSchema(db);
    verifyIntegrity();
};

export const getItem = (id: string): ItemRow | undefined =>
    db!.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined;

// better-sqlite3 calls are synchronous with no internal await, so concurrent
// callers (see ITEM_CONCURRENCY in mediaIndexer.js) can never interleave
// mid-write.
export const upsertItem = ({ id, metadata }: UpsertItemInput): void => {
    const columns = ["id", ...METADATA_COLUMNS];
    const assignments = METADATA_COLUMNS.map((c) => `${c} = excluded.${c}`).join(", ");
    const stmt = db!.prepare(`
        INSERT INTO items (${columns.join(", ")}) VALUES (${columns.map((c) => `@${c}`).join(", ")})
        ON CONFLICT(id) DO UPDATE SET ${assignments}
    `);
    stmt.run({ id, ...metadata });
};

// Records that mediaId's file produced itemId's content. Idempotent -
// mediaIndexer.js calls this every time it touches an item, including when
// the item's baseMd5/baseGrey were already computed by an earlier indexing
// pass over the same media (e.g. a previous rebuild).
export const linkItemMedia = (itemId: string, mediaId: string): void => {
    db!.prepare("INSERT OR IGNORE INTO media_item (mediaId, itemId) VALUES (?, ?)").run(mediaId, itemId);
};

// Every (item, media) link with a stored pixel buffer, for duplicateFinder.js's
// pairwise mean-pixel-difference comparison (baseGrey has no index - distance
// can't be expressed as a SQL equality/range lookup on a blob). One row per
// media sharing that content, not per item - so byte-identical duplicate
// media (same baseGrey, diff = 0) fall out of the same comparison the
// near-duplicate case already does, with no special-casing needed.
export const allBaseGreyRows = (): BaseGreyRow[] => db!
    .prepare(`
        SELECT media_item.mediaId AS mediaId, items.baseGrey AS baseGrey, media.localPath AS localPath 
        , media.contentMd5 AS contentMd5 , items.baseMd5 AS baseMd5 , items.baseMd5Blur AS baseMd5Blur
        FROM media_item
        JOIN items ON items.id = media_item.itemId
        JOIN media ON media.id = media_item.mediaId
        WHERE items.baseGrey IS NOT NULL
    `)
    .all() as BaseGreyRow[];

// Every item linked to a media (1 for an image, up to the 4 frame positions
// for a video/GIF - see mediaIndexer.js), for detectObjects to run per-item
// detection instead of once per media.
export const itemsForMedia = (mediaId: string): MediaItemRow[] => db!
    .prepare(`
        SELECT media_item.itemId AS itemId, items.framePosition AS framePosition
        FROM media_item
        JOIN items ON items.id = media_item.itemId
        WHERE media_item.mediaId = ?
    `)
    .all(mediaId) as MediaItemRow[];

// Decimal places detection boxes (item_detection x/y/w/h) are rounded to when
// deciding two media "share" a box. The detector's normalised coordinates are
// floats, so exact equality would almost never match; 4 places (~1/10000 of
// the frame) absorbs float noise while staying far tighter than any real
// difference between two distinct objects.
export const BOX_ROUND_DECIMALS = 2;

// Groups of media whose object detections match with score > min_score:
//   1) ROUND filter : each frame gets a rounded "centre of mass" of its boxes; frames of
//                     different media in the same or a neighbouring rounded cell are candidates
//   2) seed         : a candidate frame pair is a seed if >= 50% of its boxes overlap (IoU)
//   3) score        : seeded media pairs are scored on ALL their frames: share of boxes
//                     with a same-class box at IoU >= iou_min
//   4) groups       : pairs above min_score are chained into groups (A~B, B~C -> [A,B,C])
// json_group_array rather than GROUP_CONCAT so ids are never split on a comma.
// n_media/min_score/max_score are selected but not used yet - only mediaIds is.
export const mediaIdGroupsBySharedBox = (): string[][] => {
    // Rounding step for frame centres derived from BOX_ROUND_DECIMALS (2 -> 0.01 = 1% of width/height).
    const r = 10 ** -BOX_ROUND_DECIMALS;
    const rows = db!
        .prepare(`
            WITH RECURSIVE params(r, area_tol, n_tol, iou_min, min_score) AS (
              VALUES (${r},   -- rounding step for frame centres
                      0.15,   -- max relative difference of total box area between two frames
                      2,      -- max difference in box count between two frames
                      0.6,    -- IoU for two boxes to count as the same object
                      0.6)    -- media score needed to be the same media
            ),
            det AS MATERIALIZED (            -- MATERIALIZED keeps the fast plan with or without an itemId index
              SELECT mi.mediaId, d.itemId, d.rowid AS detId, d.classId, d.x, d.y, d.w, d.h
              FROM item_detection d
              JOIN media_item mi ON mi.itemId = d.itemId
            ),
            frame AS (                        -- one row per frame (item) of each media
              SELECT d.mediaId, d.itemId, COUNT(*) AS n, SUM(d.w * d.h) AS area,
                     SUM((d.x + d.w / 2) * d.w * d.h) / SUM(d.w * d.h)                AS cx,
                     SUM((d.y + d.h / 2) * d.w * d.h) / SUM(d.w * d.h)                AS cy,
                     ROUND(SUM((d.x + d.w / 2) * d.w * d.h) / SUM(d.w * d.h) / p.r) AS bx,
                     ROUND(SUM((d.y + d.h / 2) * d.w * d.h) / SUM(d.w * d.h) / p.r) AS by
              FROM det d, params p
              GROUP BY d.mediaId, d.itemId
            ),
            media_frames AS (SELECT mediaId, COUNT(*) AS nf FROM frame GROUP BY mediaId),
            off(o) AS (VALUES (-1), (0), (1)),
            -- 1) ROUND filter: same or neighbouring cell, then exact tolerance checks
            cand AS (
              SELECT a.mediaId AS ma, a.itemId AS ia, b.mediaId AS mb, b.itemId AS ib, a.n + b.n AS nn
              FROM frame a
              CROSS JOIN off ox
              CROSS JOIN off oy
              JOIN frame b ON b.bx = a.bx + ox.o AND b.by = a.by + oy.o
              CROSS JOIN params p
              WHERE a.mediaId < b.mediaId
                AND ABS(a.cx - b.cx) <= p.r
                AND ABS(a.cy - b.cy) <= p.r
                AND ABS(a.area - b.area) <= p.area_tol * MAX(a.area, b.area)
                AND ABS(a.n - b.n) <= p.n_tol
            ),
            -- 2) seed: candidate frame pairs whose boxes really overlap
            -- (inter >= t/(1+t) * (areaA + areaB)  is  IoU >= t  written without a division)
            cand_sim AS (
              SELECT c.ma, c.mb, 1.0 * (COUNT(DISTINCT a.detId) + COUNT(DISTINCT b.detId)) / c.nn AS sim
              FROM cand c
              JOIN det a ON a.itemId = c.ia AND a.mediaId = c.ma
              JOIN det b ON b.itemId = c.ib AND b.mediaId = c.mb AND b.classId = a.classId
              CROSS JOIN params p
              WHERE MAX(0, MIN(a.x + a.w, b.x + b.w) - MAX(a.x, b.x)) *
                    MAX(0, MIN(a.y + a.h, b.y + b.h) - MAX(a.y, b.y))
                    >= p.iou_min / (1 + p.iou_min) * (a.w * a.h + b.w * b.h)
              GROUP BY c.ma, c.mb, c.ia, c.ib
            ),
            seed AS (SELECT DISTINCT ma, mb FROM cand_sim WHERE sim >= 0.5),
            -- 3) score seeded media pairs on every frame pair
            frame_sim AS (
              SELECT s.ma, s.mb, fa.itemId AS ia, fb.itemId AS ib,
                     1.0 * (COUNT(DISTINCT a.detId) + COUNT(DISTINCT b.detId)) / (fa.n + fb.n) AS sim
              FROM seed s
              JOIN frame fa ON fa.mediaId = s.ma
              JOIN frame fb ON fb.mediaId = s.mb
              JOIN det a ON a.itemId = fa.itemId AND a.mediaId = s.ma
              JOIN det b ON b.itemId = fb.itemId AND b.mediaId = s.mb AND b.classId = a.classId
              CROSS JOIN params p
              WHERE MAX(0, MIN(a.x + a.w, b.x + b.w) - MAX(a.x, b.x)) *
                    MAX(0, MIN(a.y + a.h, b.y + b.h) - MAX(a.y, b.y))
                    >= p.iou_min / (1 + p.iou_min) * (a.w * a.h + b.w * b.h)
              GROUP BY s.ma, s.mb, fa.itemId, fb.itemId
            ),
            frame_best AS (                   -- every frame keeps its best counterpart in the other media
              SELECT ma, mb, MAX(sim) AS sim FROM frame_sim GROUP BY ma, mb, ia
              UNION ALL
              SELECT ma, mb, MAX(sim)        FROM frame_sim GROUP BY ma, mb, ib
            ),
            pair_score AS (                   -- frames without any match count as 0
              SELECT x.ma, x.mb, SUM(x.sim) / (fa.nf + fb.nf) AS score
              FROM frame_best x
              JOIN media_frames fa ON fa.mediaId = x.ma
              JOIN media_frames fb ON fb.mediaId = x.mb
              GROUP BY x.ma, x.mb
              HAVING SUM(x.sim) / (fa.nf + fb.nf) > (SELECT min_score FROM params)
            ),
            -- 4) chain matching pairs into groups
            edge(u, v) AS (
              SELECT ma, mb FROM pair_score
              UNION ALL
              SELECT mb, ma FROM pair_score
            ),
            reach(root, node) AS (
              SELECT u, u FROM edge
              UNION
              SELECT r.root, e.v FROM reach r JOIN edge e ON e.u = r.node
            ),
            grp AS (SELECT node AS mediaId, MIN(root) AS gid FROM reach GROUP BY node)
            SELECT json_group_array(DISTINCT g.mediaId) AS mediaIds,
                   COUNT(DISTINCT g.mediaId)            AS n_media,
                   ROUND(MIN(s.score), 3)               AS min_score,
                   ROUND(MAX(s.score), 3)               AS max_score
            FROM grp g
            JOIN pair_score s ON g.mediaId IN (s.ma, s.mb)
            GROUP BY g.gid
            ORDER BY n_media DESC, max_score DESC
        `)
        .all() as Array<{ mediaIds: string; n_media: number; min_score: number; max_score: number }>;
    return rows.map(row => JSON.parse(row.mediaIds) as string[]);
};

// One entry per non-null items.baseMd5Blur that is linked to more than one
// media, holding those media ids.
export const mediaIdGroupsBySharedBlur = (): string[][] => {
    const rows = db!
        .prepare(`
            SELECT json_group_array(DISTINCT mi.mediaId) AS mediaIds
            FROM items
            JOIN media_item mi ON mi.itemId = items.id
            WHERE items.baseMd5Blur IS NOT NULL
            GROUP BY items.baseMd5Blur
            HAVING COUNT(DISTINCT mi.mediaId) > 1
        `)
        .all() as Array<{ mediaIds: string }>;
    return rows.map(row => JSON.parse(row.mediaIds) as string[]);
};

// Overwrites the stored duplicate-group result with a freshly computed one.
// Each call to duplicateFinder.findIndexDuplicates() re-scans the whole
// library, so its result is a complete snapshot, not an incremental delta -
// wiping first means media that's since moved/been deleted (or stopped
// matching) doesn't linger in a stale group. Wrapped in a transaction so a
// crash mid-write can't leave the table half-cleared. Groups of fewer than 2
// media are dropped - a "group" of one isn't a duplicate of anything.
export const replaceDuplicateGroups = (groups: string[][]): void => {
    const replace = db!.transaction((groups: string[][]): void => {
        db!.prepare("DELETE FROM items_duplicated").run();
        const insert = db!.prepare("INSERT INTO items_duplicated (groupId, mediaId) VALUES (?, ?)");
        for (const group of groups) {
            if (group.length < 2) continue;
            const groupId = crypto.randomUUID();
            for (const mediaId of group) insert.run(groupId, mediaId);
        }
    });
    replace(groups);
};

// Reads the persisted duplicate groups back out, grouped by groupId - lets a
// caller show the last scan's result without re-running the slow O(n^2) scan.
export const getDuplicateGroups = (): string[][] => {
    const rows = db!
        .prepare("SELECT groupId, mediaId FROM items_duplicated ORDER BY groupId")
        .all() as Array<{ groupId: string; mediaId: string }>;

    const groups = new Map<string, string[]>();
    for (const row of rows) {
        if (!groups.has(row.groupId)) groups.set(row.groupId, []);
        (groups.get(row.groupId) as string[]).push(row.mediaId);
    }
    return [...groups.values()];
};

// The fingerprint generation this index's baseMd5/baseGrey values were
// produced by, for dbImport.ts to refuse comparing across generations.
export const fingerprintVersion = (): number => FINGERPRINT_VERSION;

export const countItems = (): number => (db!.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n;

// Uses SQLite's online backup API (safe on a live connection, unlike copying
// the file directly which could race a write) so the exported file is a
// consistent snapshot other machines can later import and compare against.
export const exportDatabase = (destPath: string): Promise<Database.BackupMetadata> => {
    ensureReady();
    return db!.backup(destPath);
};

// Single shared connection for mediaDb/MediaStore.js - callers must not open
// a second `new Database(...)` on the same file.
export const getDb = (): Database.Database => {
    ensureReady();
    return db!;
};
