const os = require("os");


const isDev = process.env.NODE_ENV === "development";

const dirCache = isDev ? process.cwd() : os.tmpdir();

module.exports = {
    dirCache,
};

// const dirCache = isDev ? path.join(process.cwd(), "cache") : path.join(os.tmpdir(), "cache");