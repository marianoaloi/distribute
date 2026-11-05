import * as compareImgStore from "./HashStore";
import { baseGreyRowsForBucket, multiFrameBuckets } from "./bucketQueries";
import { clustersOf, compareBucket, compareBucketExactOnly, makeDisjointSet, mergeGroups } from "./duplicateMath";

// The pure helpers live in duplicateMath.ts (unit-testable without SQLite);
// re-exported for existing importers (dbImport.ts).
export { meanAbsDiff, MEAN_DIFF_THRESHOLD } from "./duplicateMath";

// Media that share an object-detection box (same class, coordinates equal to
// BOX_ROUND_DECIMALS places) are duplicate candidates. A media sharing ANY box
// with another joins its cluster, so per-box groups are merged. Computed on
// demand from item_detection; not persisted.
export const findObjectDuplicates = (): string[][] => {
    compareImgStore.ensureReady();
    return mergeGroups(compareImgStore.mediaIdGroupsBySharedBox());
};

// Video/GIF media whose extracted frames carry the same signature (detected
// classes at the same frame positions/seconds). Each media has exactly one
// signature, so the groups are already disjoint and need no mergeGroups.
// Computed on demand; not persisted.
export const findFrameDuplicates = (): string[][] => {
    compareImgStore.ensureReady();
    return compareImgStore.mediaIdGroupsByFrameSignature();
};

// Video/GIF media of the same length sharing the blur hash on several frames at
// the same positions. The store returns matching pairs; mergeGroups chains them
// (A~B, B~C -> [A,B,C]). Computed on demand; not persisted.
export const findBlurFrameDuplicates = (): string[][] => {
    compareImgStore.ensureReady();
    return mergeGroups(compareImgStore.mediaIdPairsBySharedBlurFrames());
};

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
// Memory: the coarse grouping is done in SQL (bucketQueries.ts), and only
// one bucket's rows are loaded at a time; singleton buckets are never read.
//
// maxBucket: a bucket bigger than this (e.g. thousands of all-black frames)
// only gets the linear exact-match pass (equal contentMd5/baseMd5), not the
// O(k^2) pixel-distance pass - logged as a warning. Unset = no cap.
//
// shouldStop: polled between buckets; a stopped scan persists nothing (the
// previous complete snapshot stays) and reports stopped.
//
// onProgress (comparedRows, totalRows) - fires once per row after its
// bucket's comparisons for that row are done, so pipeline/PipelineRun.js's
// "duplicates" stage can show a real percentage/ETA. totalRows counts rows
// in multi-frame buckets only.
export interface BucketedScanOptions {
    onProgress?: (comparedRows: number, totalRows: number) => void;
    maxBucket?: number;
    shouldStop?: () => boolean;
}

export interface BucketedScanResult {
    groups: string[][];
    stopped: boolean;
    // Buckets that exceeded maxBucket and got the exact-match pass only.
    cappedBuckets: number;
}

export const findIndexDuplicatesBucketed = async (options: BucketedScanOptions = {}): Promise<BucketedScanResult> => {
    compareImgStore.ensureReady();
    const { onProgress, maxBucket, shouldStop } = options;

    const { find, union } = makeDisjointSet();
    const matchedIds = new Set<string>();
    const markMatch = (a: string, b: string): void => {
        matchedIds.add(a);
        matchedIds.add(b);
        union(a, b);
    };

    // Stage 1: coarse grouping by baseMd5Blur, in SQL.
    const buckets = multiFrameBuckets();
    const totalRows = buckets.reduce((sum, b) => sum + b.n, 0);
    const largest = [...buckets].sort((a, b) => b.n - a.n).slice(0, 5);
    console.log(`compareImg: ${totalRows} frames in ${buckets.length} multi-frame baseMd5Blur groups (largest: ${largest.map(b => b.n).join(", ") || "none"})`);
    if (onProgress) onProgress(0, totalRows);

    // Stage 2: the fine comparison, one bucket in memory at a time.
    let compared = 0;
    let cappedBuckets = 0;
    const onRow = (): void => {
        compared++;
        if (onProgress) onProgress(compared, totalRows);
    };
    for (const { key, n } of buckets) {
        if (shouldStop?.()) return { groups: [], stopped: true, cappedBuckets };
        const bucket = baseGreyRowsForBucket(key);
        if (maxBucket !== undefined && n > maxBucket) {
            cappedBuckets++;
            console.warn(`compareImg: baseMd5Blur group ${key ?? "(no key)"} has ${n} frames (> ${maxBucket}) - exact matches only, near-duplicates in it are not compared`);
            compareBucketExactOnly(bucket, markMatch, onRow);
        } else {
            compareBucket(bucket, markMatch, onRow);
        }
        // The buckets are compared synchronously; yield between them so
        // signals (SIGINT) and IPC are still serviced on a long scan.
        await new Promise<void>(resolve => setImmediate(resolve));
    }

    const result = clustersOf(matchedIds, find);
    // Persist the result (items_duplicated table) so it survives an app
    // restart instead of only living in this function's return value.
    compareImgStore.replaceDuplicateGroups(result);
    return { groups: result, stopped: false, cappedBuckets };
};

// The GUI's entry point: no cap, never stopped.
export const findIndexDuplicates = async (onProgress?: (comparedRows: number, totalRows: number) => void): Promise<string[][]> =>
    (await findIndexDuplicatesBucketed({ onProgress })).groups;
