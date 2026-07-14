const path = require("path");
const fs = require("fs");
const cache = require("./cache");
const { getPlaceholderPath } = require("./providers/placeholder");

const providers = [
    require("./providers/ffmpegStatic"),
    require("./providers/ffmpegthumbnailer"),
];

let selected;
const getProvider = () => {
    if (selected === undefined) {
        selected = providers.find((p) => p.isAvailable()) || null;
        console.log("Thumbnail provider:", selected ? selected.name : "none (placeholder only)");
    }
    return selected;
};

// Some filenames break the encoder: retry through a hard link with a safe name
const linkPathFor = (input) => path.join(cache.linkDir, cache.hashFor(input) + path.extname(input));

const withLinkRetrySync = (provider, input, output) => {
    try {
        provider.generateSync(input, output);
    } catch {
        const tmp = linkPathFor(input);
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        fs.linkSync(input, tmp);
        try {
            provider.generateSync(tmp, output);
        } finally {
            fs.unlinkSync(tmp);
        }
    }
};

const withLinkRetry = async (provider, input, output) => {
    try {
        await provider.generate(input, output);
    } catch {
        const tmp = linkPathFor(input);
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        fs.linkSync(input, tmp);
        try {
            await provider.generate(tmp, output);
        } finally {
            fs.unlinkSync(tmp);
        }
    }
};

// Never throws: always resolves to a path the renderer can display
const getThumbnailSync = (videoPath) => {
    const output = cache.thumbnailPathFor(videoPath);
    if (fs.existsSync(output)) return output;
    const provider = getProvider();
    if (provider) {
        try {
            cache.ensureCacheDir();
            withLinkRetrySync(provider, videoPath, output);
            if (fs.existsSync(output)) return output;
        } catch (error) {
            console.error("Thumbnail failed for", videoPath, "-", error.message);
        }
    }
    return getPlaceholderPath();
};

const getThumbnail = async (videoPath) => {
    const output = cache.thumbnailPathFor(videoPath);
    if (fs.existsSync(output)) return output;
    const provider = getProvider();
    if (provider) {
        try {
            cache.ensureCacheDir();
            await withLinkRetry(provider, videoPath, output);
            if (fs.existsSync(output)) return output;
        } catch (error) {
            console.error("Thumbnail failed for", videoPath, "-", error.message);
        }
    }
    return getPlaceholderPath();
};

module.exports = {
    getThumbnail,
    getThumbnailSync,
    ensureCacheDir: cache.ensureCacheDir,
};
