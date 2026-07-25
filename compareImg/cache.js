const path = require("path");
const fs = require("fs");
const { dirCache } = require("../DirectorioCache");

// SQLite file backing the perceptual-hash index (see HashStore.js)
const dbDir = path.join(dirCache, "tmp", "hashIndex");
const dbPath = path.join(dbDir, "index.db");

// Extracted video frames (kept so re-scanning a folder doesn't re-invoke ffmpeg)
const framesDir = path.join(dirCache, "tmp", "frames");

const ensureFramesDir = () => {
    fs.mkdirSync(framesDir, { recursive: true });
};

module.exports = {
    dbDir,
    dbPath,
    framesDir,
    ensureFramesDir,
};
