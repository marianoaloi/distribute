const fs = require("fs");
const crypto = require("crypto");
const compareImgStore = require("./VectorStore");
const imageTransform = require("./imageTransform");

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

// Metadata fields on a compareImg index item whose values, when shared by
// more than one item, mean the underlying files are perceptual duplicates.
const HASH_FIELDS = ["baseMd5", ...imageTransform.BLUR_LEVELS.map(level => `blur_${level}`)];

// Minimal union-find so a match on any one of HASH_FIELDS merges two media
// ids into the same duplicate cluster, even if they didn't match on others.
const makeDisjointSet = () => {
    const parent = new Map();
    const find = (x) => {
        if (!parent.has(x)) parent.set(x, x);
        let root = x;
        while (parent.get(root) !== root) root = parent.get(root);
        let cur = x;
        while (parent.get(cur) !== root) {
            const next = parent.get(cur);
            parent.set(cur, root);
            cur = next;
        }
        return root;
    };
    const union = (a, b) => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) parent.set(rootA, rootB);
    };
    return { find, union };
};

// Groups compareImg index items by each hash field (baseMd5, blur_1..blur_16)
// in turn; whenever more than one item shares a value for a field, the media
// they belong to (metadata.actualPosition, the app's media id) are flagged
// as duplicates of each other.
const findIndexDuplicates = async () => {
    const items = await compareImgStore.index.listItems();
    const { find, union } = makeDisjointSet();
    const matchedIds = new Set();

    for (const field of HASH_FIELDS) {
        const byValue = groupBy(items.filter(item => item.metadata[field]), item => item.metadata[field]);
        for (const sameValueItems of byValue.values()) {
            const ids = [...new Set(sameValueItems.map(item => item.metadata.actualPosition))];
            if (ids.length < 2) continue;

            ids.forEach(id => matchedIds.add(id));
            for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
        }
    }

    const groups = new Map();
    for (const id of matchedIds) {
        const root = find(id);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(id);
    }

    return [...groups.values()].filter(group => group.length > 1);
};

module.exports = {
    findDuplicates,
    findIndexDuplicates,
    contentHashFor,
};
