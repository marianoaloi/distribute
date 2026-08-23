import fs from "fs";
import crypto from "crypto";
import Database from "better-sqlite3";
import { getDbDir, getDbPath } from "./cache";
import { createMediaSchema } from "../mediaDb/mediaSchema";

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
const METADATA_COLUMNS = ["framePosition", "framePositionSeconds", "futurePosition", "baseMd5", "baseGrey"] as const;

export interface ItemRow {
    id: string;
    framePosition: string;
    /** Frame's timestamp within the source video/GIF, in seconds (fractional). Null for images. */
    framePositionSeconds: number | null;
    futurePosition: number;
    baseMd5: string | null;
    baseGrey: Buffer | null;
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
        futurePosition: number;
        baseMd5: string;
        baseGrey: Buffer;
    };
}

export interface BaseGreyRow {
    mediaId: string;
    baseGrey: Buffer;
    localPath: string;
    contentMd5: string | null;
    baseMd5: string | null;
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
            futurePosition INTEGER NOT NULL DEFAULT -1,
            baseMd5 TEXT,
            baseGrey BLOB
        );
    `);
    ensureColumn(database, "items", "baseGrey", "BLOB");
    ensureColumn(database, "items", "framePositionSeconds", "REAL");
    database.exec("CREATE INDEX IF NOT EXISTS idx_items_baseMd5 ON items(baseMd5);");

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

    createMediaSchema(database);
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
        , media.contentMd5 AS contentMd5 , items.baseMd5 AS baseMd5
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

// Column names of the live items table, for validating that an imported
// (exported-elsewhere) database has the identical structure before comparing.
export const columnNames = (): string[] =>
    (db!.pragma("table_info(items)") as Array<{ name: string }>).map((c) => c.name);

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
