// DDL only - requires nothing, so HashStore can require this without a cycle
// (HashStore -> mediaSchema, MediaStore -> HashStore).
const createMediaSchema = (database) => {
    database.exec(`
        CREATE TABLE IF NOT EXISTS media (
            id          TEXT PRIMARY KEY,
            localPath   TEXT NOT NULL,
            filename    TEXT NOT NULL,
            mime        TEXT,
            kind        TEXT NOT NULL,
            size        INTEGER NOT NULL DEFAULT 0,
            mtimeMs     REAL    NOT NULL DEFAULT 0,
            contentMd5  TEXT,
            hasAudio    INTEGER NOT NULL DEFAULT 0,
            thumbPath   TEXT,
            updatedAt   INTEGER NOT NULL DEFAULT 0
        );
    `);
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_media_localPath ON media(localPath);");
    database.exec("CREATE INDEX IF NOT EXISTS idx_media_contentMd5 ON media(contentMd5);");

    // Index-only addition to the existing (frozen, see compareImg/dbImport.js)
    // items table: actualPosition already holds the media id.
    database.exec("CREATE INDEX IF NOT EXISTS idx_items_actualPosition ON items(actualPosition);");

    database.exec(`
        CREATE TABLE IF NOT EXISTS detection_class (
            classId   INTEGER PRIMARY KEY,
            name      TEXT NOT NULL,
            updatedAt INTEGER NOT NULL DEFAULT 0
        );
    `);

    // mediaId is a logical FK (not a declared REFERENCES): better-sqlite3 runs
    // with PRAGMA foreign_keys = ON, and detection also runs over transient
    // { imported: true } items (compareImg/dbImport.js) that have no media row.
    database.exec(`
        CREATE TABLE IF NOT EXISTS media_detection (
            mediaId    TEXT    NOT NULL,
            classId    INTEGER NOT NULL,
            className  TEXT    NOT NULL,
            score      REAL    NOT NULL,
            x          REAL    NOT NULL,
            y          REAL    NOT NULL,
            w          REAL    NOT NULL,
            h          REAL    NOT NULL,
            modelPath  TEXT,
            detectedAt INTEGER NOT NULL DEFAULT 0
        );
    `);
    database.exec("CREATE INDEX IF NOT EXISTS idx_media_detection_mediaId ON media_detection(mediaId);");
    database.exec("CREATE INDEX IF NOT EXISTS idx_media_detection_classId ON media_detection(classId);");
};

module.exports = { createMediaSchema };
