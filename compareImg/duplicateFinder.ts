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

// Two-stage scan, coarse then fine:
//
//   1. Group every indexed frame by its baseMd5Blur (pixelHash.ts: blurred,
//      downsampled, quantised key) - a Map lookup, O(n). Frames whose key
//      differs are never compared at all.
//   2. Inside each group, pairwise-compare pixel buffers exactly as before
//      (contentMd5 / baseMd5 equality, then mean pixel difference vs
//      MEAN_DIFF_THRESHOLD) and union matches into duplicate clusters.
//
// This replaces a single flat O(n^2) pass over every frame in the library.
// That was fine for a few hundred files but with ~2000 images + ~1000
// videos/gifs at up to 4 frames each (~6000 rows -> ~18M buffer
// comparisons) it became the stage the pipeline stalled on. The fine
// comparison is unchanged; it just runs on candidate groups instead of on
// everything. The cost is now sum(k_i^2) over group sizes, which for a
// library where most frames are unique is close to linear.
//
// What the coarse key cannot do: two frames the fine filter would accept
// can still hash into different groups when a blurred cell sits right at a
// brightness-band edge (see pixelHash.ts for the parameters that trade this
// off against group size). Exact-content duplicates never split, since an
// identical baseGrey always yields an identical baseMd5Blur.
//
// Rows with no key (a baseGrey whose length no longer matches the current
// geometry, so HashStore's backfill could not derive one) form one group of
// their own - meanAbsDiff already treats such buffers as infinitely far
// from everything, so nothing is lost by not comparing them further afield.
//
// onProgress (comparedRows, totalRows) - fires once per row after its
// group's comparisons for that row are done, so pipeline/PipelineRun.js's
// "duplicates" stage can show a real percentage/ETA.
export const findIndexDuplicates = async (onProgress?: (comparedRows: number, totalRows: number) => void): Promise<string[][]> => {
    compareImgStore.ensureReady();

    const { find, union } = makeDisjointSet();
    const matchedIds = new Set<string>();
    const markMatch = (a: string, b: string): void => {
        matchedIds.add(a);
        matchedIds.add(b);
        union(a, b);
    };

    const rows = compareImgStore.allBaseGreyRows();
    if (onProgress) onProgress(0, rows.length);

    // Stage 1: coarse grouping by baseMd5Blur.
    const NO_KEY = "";
    const buckets = new Map<string, compareImgStore.BaseGreyRow[]>();
    for (const row of rows) {
        const key = row.baseMd5Blur ?? NO_KEY;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(row);
        else buckets.set(key, [row]);
    }
    let largest = 0;
    for (const bucket of buckets.values()) largest = Math.max(largest, bucket.length);
    console.log(`compareImg: ${rows.length} frames in ${buckets.size} baseMd5Blur groups (largest ${largest})`);

    // Stage 2: the fine comparison, only within a group.
    let compared = 0;
    for (const bucket of buckets.values()) {
        for (let i = 0; i < bucket.length; i++) {
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
            compared++;
            if (onProgress) onProgress(compared, rows.length);
        }
    }

    const groups = new Map<string, string[]>();
    for (const id of matchedIds) {
        const root = find(id);
        if (!groups.has(root)) groups.set(root, []);
        (groups.get(root) as string[]).push(id);
    }

    const result = [...groups.values()].filter(group => group.length > 1);
    // Persist the result (items_duplicated table) so it survives an app
    // restart instead of only living in this function's return value.
    compareImgStore.replaceDuplicateGroups(result);
    return result;
};
