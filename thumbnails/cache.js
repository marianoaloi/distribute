const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { getTmpRoot } = require("../DirectorioCache");

const getCacheDir = () => path.join(getTmpRoot(), "ffmpeg");

const ensureCacheDir = () => {
    fs.mkdirSync(getCacheDir(), { recursive: true });
};

const hashFor = (videoPath) => crypto.createHash("md5").update(videoPath).digest("hex");

const thumbnailPathFor = (videoPath) => path.join(getCacheDir(), `${hashFor(videoPath)}.jpeg`);

// Directory for the hard-link retry: fs.linkSync requires the link to be on
// the same volume as the source video, which the ffmpeg cache dir now is,
// since both live under the folder the user opened.
const getLinkDir = () => getCacheDir();

module.exports = {
    getCacheDir,
    ensureCacheDir,
    hashFor,
    thumbnailPathFor,
    getLinkDir,
};
