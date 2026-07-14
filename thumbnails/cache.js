const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { dirCache } = require("../DirectorioCache");

const cacheDir = path.join(dirCache, "tmp", "ffmpeg");

const ensureCacheDir = () => {
    fs.mkdirSync(cacheDir, { recursive: true });
};

const hashFor = (videoPath) => crypto.createHash("md5").update(videoPath).digest("hex");

const thumbnailPathFor = (videoPath) => path.join(cacheDir, `${hashFor(videoPath)}.jpeg`);

// Directory for the hard-link retry: must be on the same volume as dirCache
const linkDir = dirCache;

module.exports = {
    cacheDir,
    ensureCacheDir,
    hashFor,
    thumbnailPathFor,
    linkDir,
};
