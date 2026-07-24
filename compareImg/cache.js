const path = require("path");
const fs = require("fs");
const { dirCache } = require("../DirectorioCache");

// vectra persists the index as a folder of JSON files, mirrors thumbnails/cache.js layout
const indexDir = path.join(dirCache, "tmp", "vectorIndex");

// Extracted video frames (kept so re-scanning a folder doesn't re-invoke ffmpeg)
const framesDir = path.join(dirCache, "tmp", "frames");

// @xenova/transformers' downloaded model weights (~150MB on first run)
const modelCacheDir = path.join(dirCache, "tmp", "models");

const ensureFramesDir = () => {
    fs.mkdirSync(framesDir, { recursive: true });
};

module.exports = {
    indexDir,
    framesDir,
    ensureFramesDir,
    modelCacheDir,
};
