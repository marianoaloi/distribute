const path = require("path");
const fs = require("fs");
const { getTmpRoot } = require("../DirectorioCache");

// SQLite file backing the perceptual-hash index (see HashStore.js)
const getDbDir = () => path.join(getTmpRoot(), "hashIndex");
const getDbPath = () => path.join(getDbDir(), "index.db");

// Extracted video frames (kept so re-scanning a folder doesn't re-invoke ffmpeg)
const getFramesDir = () => path.join(getTmpRoot(), "frames");

const ensureFramesDir = () => {
    fs.mkdirSync(getFramesDir(), { recursive: true });
};

module.exports = {
    getDbDir,
    getDbPath,
    getFramesDir,
    ensureFramesDir,
};
