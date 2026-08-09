const path = require("path");
const fs = require("fs");
const cache = require("./cache");
const { getPlaceholderPath } = require("./providers/placeholder");

const providers = [
    require("./providers/ffmpegStatic"),
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
const linkPathFor = (input) => path.join(cache.getLinkDir(), cache.hashFor(input) + path.extname(input));

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

// Adopts an already-cached path-hash-named thumbnail under the contentMd5
// name, so upgrading users don't regenerate their whole library and a
// thumbnail generated before the background MD5 backfill learned the file's
// contentMd5 gets re-homed. Never lets an adoption failure break the load -
// falls through to normal generation instead.
const adoptLegacyThumbnail = (videoPath, contentMd5, output) => {
    if (!contentMd5 || fs.existsSync(output)) return false;
    const legacy = cache.legacyThumbnailPathFor(videoPath);
    if (!fs.existsSync(legacy)) return false;
    try {
        fs.renameSync(legacy, output);
        return fs.existsSync(output);
    } catch (error) {
        console.error("Thumbnail adoption failed for", videoPath, "-", error.message);
        return false;
    }
};

// Never throws: always resolves to a path the renderer can display
const getThumbnailSync = (videoPath, contentMd5) => {
    const output = cache.thumbnailPathFor(videoPath, contentMd5);
    if (fs.existsSync(output)) return output;
    if (adoptLegacyThumbnail(videoPath, contentMd5, output)) return output;
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

const getThumbnail = async (videoPath, contentMd5) => {
    const output = cache.thumbnailPathFor(videoPath, contentMd5);
    if (fs.existsSync(output)) return output;
    if (adoptLegacyThumbnail(videoPath, contentMd5, output)) return output;
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

// Lets the background contentMd5 backfill (mediaDb/backfill.js) re-home a
// thumbnail as soon as it learns the file's hash, instead of waiting for the
// next getThumbnail/getThumbnailSync call - without this, the fast path in
// util.js keeps missing (looking for the contentMd5 name while the file is
// still under the legacy path-hash name) for one extra load after the hash
// becomes known. No-op (returns null) when there's nothing to adopt or
// nothing needs adopting because it's already in place.
const adoptThumbnail = (videoPath, contentMd5) => {
    if (!contentMd5) return null;
    const output = cache.thumbnailPathFor(videoPath, contentMd5);
    if (fs.existsSync(output)) return output;
    return adoptLegacyThumbnail(videoPath, contentMd5, output) ? output : null;
};

module.exports = {
    getThumbnail,
    getThumbnailSync,
    adoptThumbnail,
    ensureCacheDir: cache.ensureCacheDir,
};
