const fs = require("fs");
const Database = require("better-sqlite3");
const { getDbDir, getDbPath } = require("./cache");

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
const METADATA_COLUMNS = ["localPath", "kind", "framePosition", "actualPosition", "futurePosition", "baseMd5", "baseGrey"];

let db = null;

// Adds a column to an already-created table if it predates this schema
// version. CREATE TABLE IF NOT EXISTS is a no-op on an existing table, so
// this is the only way an existing installation's index.db picks up new
// columns without the user losing their whole index.
const ensureColumn = (database, table, name, type) => {
    const columns = database.pragma(`table_info(${table})`).map((c) => c.name);
    if (!columns.includes(name)) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
};

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
            baseGrey BLOB
        );
    `);
    ensureColumn(database, "items", "baseGrey", "BLOB");
    database.exec("CREATE INDEX IF NOT EXISTS idx_items_baseMd5 ON items(baseMd5);");
};

const openDb = () => {
    fs.mkdirSync(getDbDir(), { recursive: true });
    return new Database(getDbPath());
};

// Wipes and recreates an empty database. Used both to self-heal a corrupted
// db (rare with SQLite) and for the user-triggered "rebuild index" action.
const rebuildIndex = () => {
    if (db) db.close();
    fs.rmSync(getDbPath(), { force: true });
    db = openDb();
    createSchema(db);
};

// Closes the current connection without deleting anything, so the next
// ensureReady() call re-opens against whatever folder is active - used when
// the user switches to a different folder (its own tmp/hashIndex/index.db).
const closeConnection = () => {
    if (db) {
        db.close();
        db = null;
    }
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
// mid-write.
const upsertItem = ({ id, metadata }) => {
    const columns = ["id", ...METADATA_COLUMNS];
    const assignments = METADATA_COLUMNS.map((c) => `${c} = excluded.${c}`).join(", ");
    const stmt = db.prepare(`
        INSERT INTO items (${columns.join(", ")}) VALUES (${columns.map((c) => `@${c}`).join(", ")})
        ON CONFLICT(id) DO UPDATE SET ${assignments}
    `);
    stmt.run({ id, ...metadata });
};

// Every row with a stored pixel buffer, for duplicateFinder.js's pairwise
// mean-pixel-difference comparison (baseGrey has no index - distance can't
// be expressed as a SQL equality/range lookup on a blob).
const allBaseGreyRows = () => db
    .prepare("SELECT actualPosition, baseGrey, localPath FROM items WHERE baseGrey IS NOT NULL")
    .all();

// Column names of the live items table, for validating that an imported
// (exported-elsewhere) database has the identical structure before comparing.
const columnNames = () => db.pragma("table_info(items)").map((c) => c.name);

const countItems = () => db.prepare("SELECT COUNT(*) AS n FROM items").get().n;

// Uses SQLite's online backup API (safe on a live connection, unlike copying
// the file directly which could race a write) so the exported file is a
// consistent snapshot other machines can later import and compare against.
const exportDatabase = (destPath) => {
    ensureReady();
    return db.backup(destPath);
};

module.exports = {
    ensureReady,
    rebuildIndex,
    closeConnection,
    getItem,
    upsertItem,
    allBaseGreyRows,
    columnNames,
    countItems,
    exportDatabase,
};
