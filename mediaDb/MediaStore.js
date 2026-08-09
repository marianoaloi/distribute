const HashStore = require("../compareImg/HashStore");

const ensureReady = () => HashStore.ensureReady();

const MEDIA_COLUMNS = ["localPath", "filename", "mime", "kind", "size", "mtimeMs", "contentMd5", "hasAudio", "thumbPath", "updatedAt"];

// Callers (util.js's transformDataStreaming) re-upsert every media row on
// every folder load without knowing the backfilled contentMd5, so a plain
// `contentMd5 = excluded.contentMd5` would null out an already-hashed file
// on its very next load - undoing the backfill and making it re-hash every
// file, every open, forever. Only clear it when the file actually changed
// under the same path (size or mtime differs); otherwise keep whatever is
// already stored, and still let an explicit non-null value through so
// setContentMd5 callers (the backfill itself) aren't second-guessed.
const upsertMedia = (row) => {
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

const setContentMd5 = (id, contentMd5) => {
    const db = HashStore.getDb();
    db.prepare("UPDATE media SET contentMd5 = ?, updatedAt = ? WHERE id = ?").run(contentMd5, Date.now(), id);
};

const setThumbPath = (id, thumbPath) => {
    const db = HashStore.getDb();
    db.prepare("UPDATE media SET thumbPath = ?, updatedAt = ? WHERE id = ?").run(thumbPath, Date.now(), id);
};

// Records the class-name snapshot a media was just detected against, so a
// later detectObjects run can tell "already recognized with today's classes"
// (skip) apart from "recognized under a class list that has since changed"
// (redo). No-op update if the media row doesn't exist (e.g. an imported item).
const setDetectionState = (id, classesSnapshot) => {
    const db = HashStore.getDb();
    db.prepare("UPDATE media SET detectionClasses = ?, detectionAt = ? WHERE id = ?").run(classesSnapshot, Date.now(), id);
};

// SQLite's default SQLITE_MAX_VARIABLE_NUMBER is 999, so ids are looked up in
// chunks. The only string interpolation is the placeholder list, built purely
// from chunk.length - every id value itself is bound, never concatenated.
const ID_CHUNK = 400;

const findMediaByIds = (ids) => {
    const db = HashStore.getDb();
    const result = new Map();
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const chunk = ids.slice(i, i + ID_CHUNK);
        if (chunk.length === 0) continue;
        const placeholders = chunk.map(() => "?").join(",");
        const rows = db.prepare(
            `SELECT id, localPath, contentMd5, size, mtimeMs, hasAudio, thumbPath, detectionClasses, detectionAt FROM media WHERE id IN (${placeholders})`
        ).all(...chunk);
        for (const row of rows) result.set(row.id, row);
    }
    return result;
};

const mediaMissingContentMd5 = (limit) => {
    const db = HashStore.getDb();
    return db.prepare("SELECT id, localPath, kind FROM media WHERE contentMd5 IS NULL LIMIT ?").all(limit);
};

const getDetectionClasses = () => {
    const db = HashStore.getDb();
    return db.prepare("SELECT name FROM detection_class ORDER BY classId ASC").all().map((r) => r.name);
};

const saveDetectionClasses = (names) => {
    const db = HashStore.getDb();
    const del = db.prepare("DELETE FROM detection_class");
    const insert = db.prepare("INSERT INTO detection_class (classId, name, updatedAt) VALUES (?, ?, ?)");
    const run = db.transaction((list) => {
        del.run();
        const now = Date.now();
        list.forEach((name, classId) => insert.run(classId, name, now));
    });
    run(names);
};

const replaceDetections = (mediaId, boxes, modelPath) => {
    const db = HashStore.getDb();
    const del = db.prepare("DELETE FROM media_detection WHERE mediaId = ?");
    const insert = db.prepare(`
        INSERT INTO media_detection (mediaId, classId, className, score, x, y, w, h, modelPath, detectedAt)
        VALUES (@mediaId, @classId, @className, @score, @x, @y, @w, @h, @modelPath, @detectedAt)
    `);
    const run = db.transaction((list) => {
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

const getDetections = (mediaId) => {
    const db = HashStore.getDb();
    return db.prepare("SELECT classId, className, score, x, y, w, h, modelPath FROM media_detection WHERE mediaId = ?").all(mediaId);
};

// Every stored detection for the folder's index.db in one pass - index.db is
// per-folder, so "all rows" is exactly the media the renderer has loaded.
// Ordered by mediaId so app.js can group with a single linear scan.
const getAllDetections = () => {
    const db = HashStore.getDb();
    return db.prepare(
        "SELECT mediaId, classId, className, score, x, y, w, h, modelPath FROM media_detection ORDER BY mediaId"
    ).all();
};

module.exports = {
    ensureReady,
    upsertMedia,
    setContentMd5,
    setThumbPath,
    setDetectionState,
    findMediaByIds,
    mediaMissingContentMd5,
    getDetectionClasses,
    saveDetectionClasses,
    replaceDetections,
    getDetections,
    getAllDetections,
};
