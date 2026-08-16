const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { getTmpRoot } = require("../DirectorioCache");

const getCacheDir = () => path.join(getTmpRoot(), "ffmpeg");

const ensureCacheDir = () => {
    fs.mkdirSync(getCacheDir(), { recursive: true });
};

const hashFor = (videoPath) => crypto.createHash("md5").update(videoPath).digest("hex");

// contentMd5 is optional so every existing call site keeps working while the
// value is still unknown (it's filled in by a background backfill, not on
// the load path) - falls back to the path hash until then.
const thumbnailPathFor = (videoPath, contentMd5) => path.join(getCacheDir(), `${contentMd5 || hashFor(videoPath)}.jpeg`);

const legacyThumbnailPathFor = (videoPath) => path.join(getCacheDir(), `${hashFor(videoPath)}.jpeg`);

// Directory for the hard-link retry: fs.linkSync requires the link to be on
// the same volume as the source video, which the ffmpeg cache dir now is,
// since both live under the folder the user opened.
const getLinkDir = () => getCacheDir();

module.exports = {
    getCacheDir,
    ensureCacheDir,
    hashFor,
    thumbnailPathFor,
    legacyThumbnailPathFor,
    getLinkDir,
};
