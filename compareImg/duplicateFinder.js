const fs = require("fs");
const crypto = require("crypto");

const contentHashFor = (filepath) => new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(filepath);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
});

const groupBy = (items, keyFn) => {
    const groups = new Map();
    for (const item of items) {
        const key = keyFn(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }
    return groups;
};

// Groups media whose file content is byte-identical (same MD5). Pre-groups by
// size first so we only hash files that could possibly match, since hashing
// full video content is expensive.
const findDuplicates = async (medias) => {
    const bySize = groupBy(medias.filter(m => fs.existsSync(m.path)), m => m.size);

    const duplicateGroups = [];
    for (const sameSizeMedias of bySize.values()) {
        if (sameSizeMedias.length < 2) continue;

        const withHash = await Promise.all(sameSizeMedias.map(async media => ({
            id: media.id,
            contentHash: await contentHashFor(media.path).catch(() => null)
        })));

        const byHash = groupBy(withHash.filter(m => m.contentHash), m => m.contentHash);
        for (const sameHashMedias of byHash.values()) {
            if (sameHashMedias.length > 1) {
                duplicateGroups.push(sameHashMedias.map(m => m.id));
            }
        }
    }

    return duplicateGroups;
};

module.exports = {
    findDuplicates,
    contentHashFor,
};
