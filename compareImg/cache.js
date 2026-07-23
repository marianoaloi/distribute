const path = require("path");
const { dirCache } = require("../DirectorioCache");

// vectra persists the index as a folder of JSON files, mirrors thumbnails/cache.js layout
const indexDir = path.join(dirCache, "compareImg", "vectorIndex");

module.exports = {
    indexDir,
};
