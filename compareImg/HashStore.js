const fs = require("fs");
const Database = require("better-sqlite3");
const { dbDir, dbPath } = require("./cache");
const { BLUR_LEVELS } = require("./imageTransform");

const blurColumn = (level) => `blur_${level}`;
const BLUR_COLUMNS = BLUR_LEVELS.map(blurColumn);
// Columns duplicateFinder.js clusters media on; a shared value on any one of
// these means two items are perceptual duplicates.
const HASH_COLUMNS = ["baseMd5", ...BLUR_COLUMNS];
const METADATA_COLUMNS = ["localPath", "kind", "framePosition", "actualPosition", "futurePosition", ...HASH_COLUMNS];

let db = null;

const createSchema = (database) => {
    // actualPosition is left untyped (BLOB affinity) so whatever type the
    // caller's media id is (string or number) round-trips unchanged instead
    // of SQLite coercing it to TEXT.
    database.exec(`
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            localPath TEXT NOT NULL,
            kind TEXT NOT NULL,
            framePosition TEXT NOT NULL DEFAULT '',
            actualPosition,
            futurePosition INTEGER NOT NULL DEFAULT -1,
            baseMd5 TEXT,
            ${BLUR_COLUMNS.map((c) => `${c} TEXT`).join(",\n            ")}
        );
    `);
    for (const column of HASH_COLUMNS) {
        database.exec(`CREATE INDEX IF NOT EXISTS idx_items_${column} ON items(${column});`);
    }
};

const openDb = () => {
    fs.mkdirSync(dbDir, { recursive: true });
    return new Database(dbPath);
};

// Wipes and recreates an empty database. Used both to self-heal a corrupted
// db (rare with SQLite, but mirrors the old vectra behavior) and for the
// user-triggered "rebuild index" action.
const rebuildIndex = () => {
    if (db) db.close();
    fs.rmSync(dbPath, { force: true });
    db = openDb();
    createSchema(db);
};

const verifyIntegrity = () => {
    try {
        const result = db.pragma("integrity_check", { simple: true });
        if (result !== "ok") throw new Error(result);
    } catch (error) {
        console.error("compareImg: index corrupted, rebuilding:", error.message);
        rebuildIndex();
    }
};

const ensureReady = () => {
    if (db) return;
    db = openDb();
    createSchema(db);
    verifyIntegrity();
};

const getItem = (id) => db.prepare("SELECT * FROM items WHERE id = ?").get(id);

// better-sqlite3 calls are synchronous with no internal await, so concurrent
// callers (see ITEM_CONCURRENCY in mediaIndexer.js) can never interleave
// mid-write the way vectra's JSON-backed upsertItem could.
const upsertItem = ({ id, metadata }) => {
    const columns = ["id", ...METADATA_COLUMNS];
    const assignments = METADATA_COLUMNS.map((c) => `${c} = excluded.${c}`).join(", ");
    const stmt = db.prepare(`
        INSERT INTO items (${columns.join(", ")}) VALUES (${columns.map((c) => `@${c}`).join(", ")})
        ON CONFLICT(id) DO UPDATE SET ${assignments}
    `);
    stmt.run({ id, ...metadata });
};

// Rows sharing a value for `column` (one of HASH_COLUMNS, always an internal
// constant - never user input, so interpolating it into SQL is safe) along
// with the media id (actualPosition) that value belongs to. Used by
// duplicateFinder.js to cluster media without loading full item rows.
const valuesForColumn = (column) => db
    .prepare(`SELECT ${column} AS value, actualPosition FROM items WHERE ${column} IS NOT NULL AND ${column} != ''`)
    .all();

module.exports = {
    ensureReady,
    rebuildIndex,
    getItem,
    upsertItem,
    valuesForColumn,
    HASH_COLUMNS,
};
