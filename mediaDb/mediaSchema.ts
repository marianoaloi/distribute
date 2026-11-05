import type Database from "better-sqlite3";
import { formatClassExpr, legacyGroupToExpr } from "./classExpr";

// Duplicated from HashStore.js rather than imported: this file is DDL-only
// and must stay requirable with no dependencies, so HashStore can require it
// without a cycle (HashStore -> mediaSchema, MediaStore -> HashStore).
const ensureColumn = (database: Database.Database, table: string, name: string, type: string): void => {
    const columns = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (!columns.some((c) => c.name === name)) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
};

export const createMediaSchema = (database: Database.Database): void => {
    // futurePosition is where the file ended up after the user filed it into a
    // destination folder - the absolute path it was MOVED to, written only once
    // the rename actually succeeded on disk (app.ts's reportFileProcessed).
    // It lived on compareImg's `items` table before, as a permanently -1
    // INTEGER that nothing ever read: a "final location" is a path, and it
    // belongs to the media (the thing that moves), not to an item (a
    // content fingerprint of one frame, which several media can share).
    //
    // The pair with localPath is the invariant everything else relies on:
    //   futurePosition IS NULL     -> the file is at localPath
    //   futurePosition IS NOT NULL -> the file is at futurePosition,
    //                                 and came from localPath
    // localPath is deliberately never rewritten by a move, so the origin
    // survives to be moved back to. The one exception is the kind-folder sort
    // (organize/sortMediaByKind.ts): it makes the new location the home, via
    // MediaStore.relocateMedia - localPath and id change, futurePosition is
    // cleared, and there is no undo. movedAt/moveBatchId record when, and as
    // part of which single user action (one click can move two groups - see
    // folder.tsx's split move), purely so a future "revert that batch" can be
    // a plain query; the live undo stack is in-memory (undo/UndoStack.ts).
    database.exec(`
        CREATE TABLE IF NOT EXISTS media (
            id             TEXT PRIMARY KEY,
            localPath      TEXT NOT NULL,
            filename       TEXT NOT NULL,
            mime           TEXT,
            kind           TEXT NOT NULL,
            size           INTEGER NOT NULL DEFAULT 0,
            mtimeMs        REAL    NOT NULL DEFAULT 0,
            contentMd5     TEXT,
            hasAudio       INTEGER NOT NULL DEFAULT 0,
            thumbPath      TEXT,
            futurePosition TEXT,
            movedAt        INTEGER,
            moveBatchId    TEXT,
            updatedAt      INTEGER NOT NULL DEFAULT 0
        );
    `);
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_media_localPath ON media(localPath);");
    database.exec("CREATE INDEX IF NOT EXISTS idx_media_contentMd5 ON media(contentMd5);");
    // CREATE TABLE IF NOT EXISTS is a no-op on a table that predates these
    // three columns, so an existing index.db only picks them up here.
    ensureColumn(database, "media", "futurePosition", "TEXT");
    ensureColumn(database, "media", "movedAt", "INTEGER");
    ensureColumn(database, "media", "moveBatchId", "TEXT");

    database.exec(`
        CREATE TABLE IF NOT EXISTS detection_class (
            classId   INTEGER PRIMARY KEY,
            name      TEXT NOT NULL,
            updatedAt INTEGER NOT NULL DEFAULT 0
        );
    `);

    // Predefined class-filter groups from the picked .maloi, one row per
    // group in file order. expr is canonical boolean text over raw class ids
    // (e.g. "(6 || 7) && !(1 || 2)") rather than names, so renaming a class
    // doesn't break a group - the AST is rebuilt from it on read
    // (MediaStore.getDetectionGroups) and the renderer resolves ids to names
    // against the current class list.
    //
    // One-time migration: the first version stored (classes JSON, joinType).
    // Rows are converted to expr text, then the table is rebuilt (older
    // SQLite can't drop NOT NULL columns in place) in one transaction.
    const groupColumns = database.pragma("table_info(detection_group)") as Array<{ name: string }>;
    if (groupColumns.length > 0 && !groupColumns.some((c) => c.name === "expr")) {
        const oldRows = database.prepare("SELECT position, name, classes, joinType FROM detection_group ORDER BY position ASC")
            .all() as Array<{ position: number; name: string; classes: string; joinType: string }>;
        const migrate = database.transaction(() => {
            database.exec("DROP TABLE detection_group;");
            database.exec("CREATE TABLE detection_group (position INTEGER PRIMARY KEY, name TEXT NOT NULL, expr TEXT NOT NULL);");
            const insert = database.prepare("INSERT INTO detection_group (position, name, expr) VALUES (?, ?, ?)");
            for (const r of oldRows) {
                try {
                    const classes = (JSON.parse(r.classes) as number[]).map((id) => id || 0);
                    const join = String(r.joinType).toUpperCase() === "AND" ? "AND" : "OR";
                    insert.run(r.position, r.name, formatClassExpr(legacyGroupToExpr(classes, join)));
                } catch (e) {
                    console.warn(`[detection_group] dropping unreadable legacy group "${r.name}":`, e);
                }
            }
        });
        migrate();
    }
    database.exec(`
        CREATE TABLE IF NOT EXISTS detection_group (
            position INTEGER PRIMARY KEY,
            name     TEXT NOT NULL,
            expr     TEXT NOT NULL
        );
    `);

    // Filled every time the user picks a model in chooseOnnxModel - one row
    // per distinct path ever chosen, so item_detection.modelPathId can point
    // at *which* model produced a result without repeating the path text on
    // every detection row.
    database.exec(`
        CREATE TABLE IF NOT EXISTS model_path (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            path      TEXT NOT NULL UNIQUE,
            updatedAt INTEGER NOT NULL DEFAULT 0
        );
    `);

    // One-time migration: media_detection rows are keyed by mediaId and are
    // pure cache data (regenerated by re-running detection), unlike
    // detection_class which is user-typed config. Rather than an in-place
    // ALTER (mediaId -> itemId isn't a rename, it's a different id space -
    // items, not media, per detectObjects' new per-item detection), drop the
    // old table and let detection recompute into the new one. The matching
    // per-media "already recognized" snapshot columns move down to
    // item_detection_state below (detection is per-item now, not per-media),
    // so they're dropped here too rather than left as permanently-dead columns.
    const hasOldTable = database.pragma("table_info(media_detection)") as Array<{ name: string }>;
    const hasNewTable = database.pragma("table_info(item_detection)") as Array<{ name: string }>;
    if (hasOldTable.length > 0 && hasNewTable.length === 0) {
        database.exec("DROP INDEX IF EXISTS idx_media_detection_mediaId;");
        database.exec("DROP INDEX IF EXISTS idx_media_detection_classId;");
        database.exec("DROP TABLE IF EXISTS media_detection;");
        const mediaColumns = database.pragma("table_info(media)") as Array<{ name: string }>;
        if (mediaColumns.some((c) => c.name === "detectionClasses")) {
            database.exec("ALTER TABLE media DROP COLUMN detectionClasses;");
        }
        if (mediaColumns.some((c) => c.name === "detectionAt")) {
            database.exec("ALTER TABLE media DROP COLUMN detectionAt;");
        }
    }

    // itemId is a logical FK (not a declared REFERENCES), same pattern as
    // media_item.itemId (HashStore.js): items also exist for transient
    // { imported: true } media (compareImg/dbImport.js) with no media row.
    // className is intentionally not stored here - it's looked up from
    // detection_class by classId at read time instead of duplicated per row.
    database.exec(`
        CREATE TABLE IF NOT EXISTS item_detection (
            itemId      TEXT    NOT NULL,
            classId     INTEGER NOT NULL,
            score       REAL    NOT NULL,
            x           REAL    NOT NULL,
            y           REAL    NOT NULL,
            w           REAL    NOT NULL,
            h           REAL    NOT NULL,
            modelPathId INTEGER,
            detectedAt  INTEGER NOT NULL DEFAULT 0
        );
    `);
    database.exec("CREATE INDEX IF NOT EXISTS idx_item_detection_itemId ON item_detection(itemId);");
    database.exec("CREATE INDEX IF NOT EXISTS idx_item_detection_classId ON item_detection(classId);");

    // "Already recognized under today's class list" bookkeeping, one row per
    // item (a video/GIF's 4 frame items are each detected, and so
    // skip-checked, independently - not as a whole media, unlike the old
    // media.detectionClasses/detectionAt columns this replaces). Kept as its
    // own table rather than columns on `items` (compareImg/HashStore.js) so
    // dbImport.js's cross-database structural comparison of the `items`
    // table - which two exported databases must match exactly to be
    // comparable - is unaffected by detection bookkeeping that has nothing to
    // do with item identity/content.
    database.exec(`
        CREATE TABLE IF NOT EXISTS item_detection_state (
            itemId           TEXT PRIMARY KEY,
            detectionClasses TEXT,
            detectionAt      INTEGER
        );
    `);
    // What an item was detected WITH, so a pass can tell "already detected by
    // this model against this class list" (skip) from "detected by another
    // model / class list" (redo). Rows from before these columns stay NULL
    // and so count as not done: one re-detection after upgrading.
    ensureColumn(database, "item_detection_state", "modelPathId", "INTEGER");
    ensureColumn(database, "item_detection_state", "classList", "TEXT");
};
