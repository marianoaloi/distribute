// media.localPath, futurePosition and thumbPath are stored relative to the
// opened folder (DirectorioCache's toStoredPath), and media.id is the MD5 of
// that relative path (thumbnails/cache's mediaIdFor). The rest of the app
// keeps working with absolute paths: readers resolve rows through
// resolveStoredPaths, writers convert through toStoredPath.
//
// Databases written before this stored absolute paths, with ids hashed from
// them. migrateToRelativePaths converts one of those once, the first time it
// is opened.
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";
import { fromStoredPath, getActiveRoot, toStoredPath } from "../DirectorioCache";
import { hashFor } from "../thumbnails/cache";
import { getFramesDir } from "../compareImg/cache";

interface StoredPathFields {
    localPath: string;
    futurePosition?: string | null;
    thumbPath?: string | null;
}

// A media row as read from SQL, with its paths made absolute again.
export const resolveStoredPaths = <T extends StoredPathFields>(row: T): T => {
    const resolved: StoredPathFields = { ...row, localPath: fromStoredPath(row.localPath) };
    if (row.futurePosition) resolved.futurePosition = fromStoredPath(row.futurePosition);
    if (row.thumbPath) resolved.thumbPath = fromStoredPath(row.thumbPath);
    return resolved as T;
};

const getMeta = (db: Database.Database, key: string): string | null =>
    (db.prepare("SELECT value FROM folder_meta WHERE key = ?").get(key) as { value: string | null } | undefined)?.value ?? null;

const setMeta = (db: Database.Database, key: string, value: string): void => {
    db.prepare("INSERT INTO folder_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
};

// The folder another database's relative paths belong to (dbImport reads an
// exported copy with it), or null for a database from before folder_meta.
export const readRootFolder = (db: Database.Database): string | null => {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'folder_meta'").get();
    return hasTable ? getMeta(db, "rootPath") : null;
};

const RELATIVE_FORMAT = "relative";

interface LegacyRow {
    id: string;
    localPath: string;
    futurePosition: string | null;
    thumbPath: string | null;
}

// Item ids are "<mediaId>" (an image) or "<mediaId>_<framePosition>" (a
// video/GIF frame - compareImg/mediaIndexer.ts), and a media id is always a
// 32-character MD5, so an item's media is its first 32 characters.
const ITEM_ID_TABLES: Array<[table: string, column: string]> = [
    ["items", "id"],
    ["media_item", "itemId"],
    ["item_detection", "itemId"],
    ["item_detection_state", "itemId"],
];

// Converts every row's paths, and re-keys every table holding its media or
// item ids, in one transaction. Returns old id -> new id for the frame-file
// renames that follow it.
const convertRows = (db: Database.Database, root: string): Map<string, string> => {
    const rows = db.prepare("SELECT id, localPath, futurePosition, thumbPath FROM media").all() as LegacyRow[];
    const pathOwner = new Map(rows.map(r => [r.localPath, r.id]));
    const ids = new Set(rows.map(r => r.id));
    const renamed = new Map<string, string>();
    const update = db.prepare("UPDATE media SET id = ?, localPath = ?, futurePosition = ?, thumbPath = ? WHERE id = ?");
    let skipped = 0;

    for (const row of rows) {
        const localPath = toStoredPath(row.localPath, root);
        const futurePosition = row.futurePosition ? toStoredPath(row.futurePosition, root) : null;
        let thumbPath = row.thumbPath ? toStoredPath(row.thumbPath, root) : null;
        if (localPath === row.localPath && futurePosition === row.futurePosition && thumbPath === row.thumbPath) continue;
        const id = localPath === row.localPath ? row.id : hashFor(localPath);
        // The thumbnail is the end10s frame file, renamed below with its media.
        if (thumbPath && id !== row.id && !path.isAbsolute(thumbPath)) {
            const name = path.posix.basename(thumbPath);
            if (name.startsWith(`${row.id}_`)) thumbPath = path.posix.join(path.posix.dirname(thumbPath), id + name.slice(row.id.length));
        }
        // Two rows naming the same file (e.g. "C:\Photos" and "c:\photos" on
        // Windows) end up at one relative path: the first keeps it, the
        // other is left as it was.
        const owner = pathOwner.get(localPath);
        if ((owner !== undefined && owner !== row.id) || (id !== row.id && ids.has(id))) {
            skipped++;
            continue;
        }
        update.run(id, localPath, futurePosition, thumbPath, row.id);
        pathOwner.delete(row.localPath);
        pathOwner.set(localPath, id);
        if (id !== row.id) {
            ids.delete(row.id);
            ids.add(id);
            renamed.set(row.id, id);
        }
    }

    if (renamed.size > 0) {
        db.exec("CREATE TEMP TABLE IF NOT EXISTS media_id_map (oldId TEXT PRIMARY KEY, newId TEXT NOT NULL); DELETE FROM media_id_map;");
        const insert = db.prepare("INSERT INTO media_id_map (oldId, newId) VALUES (?, ?)");
        for (const [oldId, newId] of renamed) insert.run(oldId, newId);
        for (const table of ["media_item", "items_duplicated"]) {
            db.exec(`UPDATE ${table} SET mediaId = (SELECT newId FROM media_id_map WHERE oldId = ${table}.mediaId)
                     WHERE mediaId IN (SELECT oldId FROM media_id_map)`);
        }
        for (const [table, column] of ITEM_ID_TABLES) {
            db.exec(`UPDATE ${table} SET ${column} = (SELECT newId FROM media_id_map WHERE oldId = substr(${table}.${column}, 1, 32)) || substr(${column}, 33)
                     WHERE substr(${column}, 1, 32) IN (SELECT oldId FROM media_id_map)
                       AND (length(${column}) = 32 OR substr(${column}, 33, 1) = '_')`);
        }
        db.exec("DROP TABLE media_id_map;");
    }
    if (skipped > 0) console.warn(`relativePaths: ${skipped} media row(s) left absolute - another row already holds the same relative path`);
    return renamed;
};

// Frame files are "<mediaId>_<position>.jpg" (videoFrames' framePathFor), so
// they follow their media's new id; a file that cannot be renamed is simply
// extracted again by the next index.
const renameFrameFiles = (renamed: Map<string, string>): void => {
    const dir = getFramesDir();
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
        const newId = name[32] === "_" ? renamed.get(name.slice(0, 32)) : undefined;
        if (!newId) continue;
        try {
            fs.renameSync(path.join(dir, name), path.join(dir, newId + name.slice(32)));
        } catch (error) {
            console.error("relativePaths: could not rename frame", name, "-", (error as Error).message);
        }
    }
};

// Run on every (writable) open, right after the schema: records which folder
// the stored paths are relative to, and converts a database that still
// holds absolute paths. A failed conversion rolls back and is retried on the
// next open.
export const migrateToRelativePaths = (db: Database.Database, root: string = getActiveRoot()): void => {
    setMeta(db, "rootPath", root);
    if (getMeta(db, "pathFormat") === RELATIVE_FORMAT) return;
    try {
        const renamed = db.transaction(() => {
            const result = convertRows(db, root);
            setMeta(db, "pathFormat", RELATIVE_FORMAT);
            return result;
        })();
        renameFrameFiles(renamed);
        if (renamed.size > 0) console.log(`relativePaths: converted ${renamed.size} media row(s) to paths relative to ${root}`);
    } catch (error) {
        console.error("relativePaths: converting to relative paths failed, will retry on the next open -", (error as Error).message);
    }
};
