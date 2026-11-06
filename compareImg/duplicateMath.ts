// Pure pieces of the duplicate finder (compareImg/duplicateFinder.ts): no
// SQLite, no ffmpeg - loadable by jest under plain node.

export interface DisjointSet {
    find: (x: string) => string;
    union: (a: string, b: string) => void;
}

// Two frames count as visual duplicates when their cropped/greyscale pixels
// differ, on average, by no more than this many levels out of 255. Picked
// from measuring real near-duplicate frame pairs (re-encoded/re-cropped
// re-uploads of the same video): those consistently landed around 0.3;
// unrelated frames land far higher. See scripts/debugCompareVideos.js.
export const MEAN_DIFF_THRESHOLD = 3;

// Minimal union-find so a match on any one of HASH_FIELDS merges two media
// ids into the same duplicate cluster, even if they didn't match on others.
export const makeDisjointSet = (): DisjointSet => {
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
export const meanAbsDiff = (a: Uint8Array, b: Uint8Array): number => {
    if (a.length !== b.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
};

// Merges overlapping id groups into clusters: ids that appear together in any
// one group end up in the same cluster, transitively. Clusters of fewer than 2
// ids are dropped.
export const mergeGroups = (groups: string[][]): string[][] => {
    const { find, union } = makeDisjointSet();
    const ids = new Set<string>();
    for (const group of groups) {
        for (const id of group) {
            ids.add(id);
            union(group[0], id);
        }
    }
    const clusters = new Map<string, string[]>();
    for (const id of ids) {
        const root = find(id);
        if (!clusters.has(root)) clusters.set(root, []);
        (clusters.get(root) as string[]).push(id);
    }
    return [...clusters.values()].filter(cluster => cluster.length > 1);
};

// The per-frame fields the fine comparison needs.
export interface ComparableRow {
    mediaId: string;
    baseGrey: Uint8Array;
    contentMd5: string | null;
    baseMd5: string | null;
}

// The fine comparison inside one coarse bucket: every pair of frames of
// different media matches on equal contentMd5, else equal baseMd5, else a
// mean pixel difference within MEAN_DIFF_THRESHOLD. onRow fires once per row
// once its comparisons are done (progress). shouldStop is polled every
// STOP_POLL_ROWS rows (a big bucket is k^2 work); returns false if it
// stopped before finishing the bucket.
export const STOP_POLL_ROWS = 256;

export const compareBucket = (bucket: readonly ComparableRow[], markMatch: (a: string, b: string) => void, onRow?: () => void, shouldStop?: () => boolean): boolean => {
    for (let i = 0; i < bucket.length; i++) {
        if (shouldStop && i % STOP_POLL_ROWS === 0 && i > 0 && shouldStop()) return false;
        const a = bucket[i];
        for (let j = i + 1; j < bucket.length; j++) {
            const b = bucket[j];
            if (a.mediaId === b.mediaId) continue;
            if (a.contentMd5 && b.contentMd5 && a.contentMd5 === b.contentMd5) {
                markMatch(a.mediaId, b.mediaId);
            } else if (a.baseMd5 && b.baseMd5 && a.baseMd5 === b.baseMd5) {
                markMatch(a.mediaId, b.mediaId);
            } else if (meanAbsDiff(a.baseGrey, b.baseGrey) <= MEAN_DIFF_THRESHOLD) {
                markMatch(a.mediaId, b.mediaId);
            }
        }
        onRow?.();
    }
    return true;
};

// Linear fallback for a bucket too big for the pairwise pass: only exact
// matches (equal contentMd5 or equal baseMd5 between different media) - the
// near-match by pixel distance is skipped. Linear in the bucket size.
export const compareBucketExactOnly = (bucket: ReadonlyArray<Pick<ComparableRow, "mediaId" | "contentMd5" | "baseMd5">>, markMatch: (a: string, b: string) => void, onRow?: () => void): void => {
    const firstBy = (field: "contentMd5" | "baseMd5"): void => {
        const seen = new Map<string, string>();
        for (const row of bucket) {
            const key = row[field];
            if (!key) continue;
            const first = seen.get(key);
            if (first === undefined) seen.set(key, row.mediaId);
            else if (first !== row.mediaId) markMatch(first, row.mediaId);
        }
    };
    firstBy("contentMd5");
    firstBy("baseMd5");
    for (let i = 0; i < bucket.length; i++) onRow?.();
};

// Collects union-find clusters of the matched ids, dropping singletons.
export const clustersOf = (matchedIds: Iterable<string>, find: (x: string) => string): string[][] => {
    const groups = new Map<string, string[]>();
    for (const id of matchedIds) {
        const root = find(id);
        if (!groups.has(root)) groups.set(root, []);
        (groups.get(root) as string[]).push(id);
    }
    return [...groups.values()].filter(group => group.length > 1);
};
