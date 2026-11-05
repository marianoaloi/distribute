// Bucket-at-a-time reads for the pixel duplicate scan
// (duplicateFinder.findIndexDuplicatesBucketed). Instead of loading every
// frame's baseGrey buffer at once (HashStore.allBaseGreyRows - multiple GB on
// a library of a million media), the scan asks which baseMd5Blur buckets hold
// more than one frame, then loads one bucket's rows at a time. Singleton
// buckets can never produce a match, so they are never read at all.
import * as HashStore from "./HashStore";

export interface BucketSize {
    // null = frames with no blur key (see duplicateFinder's notes).
    key: string | null;
    n: number;
}

// Same rows as allBaseGreyRows (item linked to a media row, with a pixel
// buffer), grouped by blur key. Uses idx_items_baseMd5Blur.
export const multiFrameBuckets = (): BucketSize[] => HashStore.getDb()
    .prepare(`
        SELECT items.baseMd5Blur AS key, COUNT(*) AS n
        FROM media_item
        JOIN items ON items.id = media_item.itemId
        JOIN media ON media.id = media_item.mediaId
        WHERE items.baseGrey IS NOT NULL
        GROUP BY items.baseMd5Blur
        HAVING COUNT(*) > 1
    `)
    .all() as BucketSize[];

export interface ExactKeyRow {
    mediaId: string;
    contentMd5: string | null;
    baseMd5: string | null;
}

// The same rows without the pixel buffer or path - all the exact-match-only
// pass (an over-cap bucket) needs, at a fraction of the memory.
export const exactKeyRowsForBucket = (key: string | null): ExactKeyRow[] => HashStore.getDb()
    .prepare(`
        SELECT media_item.mediaId AS mediaId, media.contentMd5 AS contentMd5, items.baseMd5 AS baseMd5
        FROM media_item
        JOIN items ON items.id = media_item.itemId
        JOIN media ON media.id = media_item.mediaId
        WHERE items.baseGrey IS NOT NULL AND ${key === null ? "items.baseMd5Blur IS NULL" : "items.baseMd5Blur = ?"}
    `)
    .all(...(key === null ? [] : [key])) as ExactKeyRow[];

export const baseGreyRowsForBucket = (key: string | null): HashStore.BaseGreyRow[] => HashStore.getDb()
    .prepare(`
        SELECT media_item.mediaId AS mediaId, items.baseGrey AS baseGrey, media.localPath AS localPath,
               media.contentMd5 AS contentMd5, items.baseMd5 AS baseMd5, items.baseMd5Blur AS baseMd5Blur
        FROM media_item
        JOIN items ON items.id = media_item.itemId
        JOIN media ON media.id = media_item.mediaId
        WHERE items.baseGrey IS NOT NULL AND ${key === null ? "items.baseMd5Blur IS NULL" : "items.baseMd5Blur = ?"}
    `)
    .all(...(key === null ? [] : [key])) as HashStore.BaseGreyRow[];
