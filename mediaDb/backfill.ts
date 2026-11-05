import fs from "fs";
import { fileMd5, FILE_HASH_CONCURRENCY } from "../hashing/fileHash";
import * as MediaStore from "./MediaStore";
import { inTransaction } from "./mediaPages";
import * as inFlight from "../system/inFlight";

const BATCH_SIZE = 200;

// Fire-and-forget pass that fills in media.contentMd5 for rows that don't
// have it yet, off the folder-load critical path. Every file is hashed
// exactly once, ever - later loads just read the memoised value.
// onProgress (attempted, total) - total is snapshotted once up front (see
// MediaStore.countMediaMissingContentMd5); attempted counts every row this
// pass touches, success or failure, so a caller tracking a progress bar
// (pipeline/PipelineRun.js's "hash" stage) always sees it reach total
// instead of stalling on rows that fail to hash.
// shouldStop is polled between batches: the batch in flight finishes (and is
// written) first, and the next pass resumes from the rows still NULL.
// Resolves the pass's outcome counts; ok is false when the pass itself
// aborted (a DB failure, not a per-file one). Fire-and-forget callers ignore
// it, the LSR "hash" stage does not.
export interface BackfillResult {
    ok: boolean;
    hashed: number;
    // The file is there but could not be read/hashed.
    failed: number;
    // The file is gone (moved/deleted since it was scanned) - not a failure.
    missing: number;
}

export const backfillContentMd5 = async (onProgress?: (attempted: number, total: number) => void, shouldStop?: () => boolean): Promise<BackfillResult> => {
    const result: BackfillResult = { ok: true, hashed: 0, failed: 0, missing: 0 };
    try {
        MediaStore.ensureReady();
        const total = MediaStore.countMediaMissingContentMd5();
        let attempted = 0;
        if (onProgress) onProgress(0, total);
        // Rows that fail (e.g. file moved/deleted mid-scan) stay
        // contentMd5-NULL - the rowid cursor walks past them so they're tried
        // once per pass and never block the rows behind them.
        let afterRowid = 0;
        for (;;) {
            if (shouldStop?.()) break;
            const batch = MediaStore.mediaMissingContentMd5(BATCH_SIZE, afterRowid);
            if (batch.length === 0) break;
            afterRowid = batch[batch.length - 1].rowid;

            // Hashes are collected and written in one transaction per batch:
            // one commit instead of one per row.
            const hashed: Array<[string, string]> = [];
            let cursor = 0;
            const runWorker = async (): Promise<void> => {
                while (cursor < batch.length) {
                    const row = batch[cursor++];
                    try {
                        const contentMd5 = await inFlight.track(row.localPath, () => fileMd5(row.localPath));
                        if (contentMd5) hashed.push([row.id, contentMd5]);
                        else if (fs.existsSync(row.localPath)) { result.failed++; console.log("backfillContentMd5: skipping", row.localPath, "- unreadable"); }
                        else { result.missing++; console.log("backfillContentMd5: skipping", row.localPath, "- no longer exists"); }
                    } catch (error) {
                        result.failed++;
                        console.error("backfillContentMd5 failed for", row.localPath, "-", (error as Error).message);
                    } finally {
                        attempted++;
                        if (onProgress) onProgress(attempted, total);
                    }
                }
            };
            const workerCount = Math.min(FILE_HASH_CONCURRENCY, batch.length);
            await Promise.all(Array.from({ length: workerCount }, runWorker));
            try {
                inTransaction(() => { for (const [id, md5] of hashed) MediaStore.setContentMd5(id, md5); });
                result.hashed += hashed.length;
            } catch {
                // One bad write rolled the batch back: redo it row by row so
                // only that row is lost (it stays NULL for the next pass).
                for (const [id, md5] of hashed) {
                    try { MediaStore.setContentMd5(id, md5); result.hashed++; } catch (error) { result.failed++; console.error("backfillContentMd5: cannot store hash for", id, "-", (error as Error).message); }
                }
            }
        }
    } catch (error) {
        console.error("backfillContentMd5 aborted:", (error as Error).message);
        result.ok = false;
    }
    return result;
};
