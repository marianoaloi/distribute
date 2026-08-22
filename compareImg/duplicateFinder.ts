import * as compareImgStore from "./HashStore";

interface DisjointSet {
    find: (x: string) => string;
    union: (a: string, b: string) => void;
}

// Minimal union-find so a match on any one of HASH_FIELDS merges two media
// ids into the same duplicate cluster, even if they didn't match on others.
const makeDisjointSet = (): DisjointSet => {
    const parent = new Map<string, string>();
    const find = (x: string): string => {
        if (!parent.has(x)) parent.set(x, x);
        let root = x;
        while (parent.get(root) !== root) root = parent.get(root) as string;
        let cur = x;
        while (parent.get(cur) !== root) {
            const next = parent.get(cur) as string;
            parent.set(cur, root);
            cur = next;
        }
        return root;
    };
    const union = (a: string, b: string): void => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) parent.set(rootA, rootB);
    };
    return { find, union };
};

// Mean absolute pixel difference (0-255 scale) between two same-length
// greyscale buffers. Different length means the rows were indexed under
// different crop/blur constants (imageTransform.js's SQUARE_SIZE/CROP_MARGIN
// changed since one of them was indexed) - not comparable, so treat as
// infinitely far apart rather than throwing or false-matching.
export const meanAbsDiff = (a: Buffer, b: Buffer): number => {
    if (a.length !== b.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
};

// Two frames count as visual duplicates when their cropped/greyscale pixels
// differ, on average, by no more than this many levels out of 255. Picked
// from measuring real near-duplicate frame pairs (re-encoded/re-cropped
// re-uploads of the same video): those consistently landed around 0.3;
// unrelated frames land far higher. See scripts/debugCompareVideos.js.
export const MEAN_DIFF_THRESHOLD = 3;

// Pairwise-compares every indexed frame's pixel buffer against every other
// (skipping frames belonging to the same media item) and unions any pair
// under MEAN_DIFF_THRESHOLD. This replaces the old per-column exact-hash
// grouping: MD5 equality can't express "almost identical", so near-duplicate
// frames (JPEG re-encode noise, slightly different crop/scale) never matched
// no matter how much blur was applied - and pushing blur radius high enough
// to smooth that noise away just made unrelated frames collide instead.
//
// O(n^2) over indexed frames, since pixel distance has no SQL-expressible
// index the way hash equality did. Fine for a personal library's worth of
// media; if this gets slow on a much larger library, bucket rows by a cheap
// coarse feature (e.g. average brightness) before doing the full comparison,
// or switch to a Hamming-distance perceptual hash with an LSH/bucket index.
export const findIndexDuplicates = async (): Promise<string[][]> => {
    compareImgStore.ensureReady();

    const { find, union } = makeDisjointSet();
    const matchedIds = new Set<string>();

    const rows = compareImgStore.allBaseGreyRows();
    for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
            const a = rows[i];
            const b = rows[j];
            if (a.mediaId === b.mediaId) continue;
            if (a.contentMd5 && b.contentMd5 && a.contentMd5 === b.contentMd5) {
                matchedIds.add(a.mediaId);
                matchedIds.add(b.mediaId);
                union(a.mediaId, b.mediaId);
            } else
            if (a.baseMd5 && b.baseMd5 && a.baseMd5 === b.baseMd5) {
                matchedIds.add(a.mediaId);
                matchedIds.add(b.mediaId);
                union(a.mediaId, b.mediaId);
            } else
            if (meanAbsDiff(a.baseGrey, b.baseGrey) <= MEAN_DIFF_THRESHOLD) {
                matchedIds.add(a.mediaId);
                matchedIds.add(b.mediaId);
                union(a.mediaId, b.mediaId);
            }
        }
    }

    const groups = new Map<string, string[]>();
    for (const id of matchedIds) {
        const root = find(id);
        if (!groups.has(root)) groups.set(root, []);
        (groups.get(root) as string[]).push(id);
    }

    return [...groups.values()].filter(group => group.length > 1);
};
