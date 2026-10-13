import { fileMd5, FILE_HASH_CONCURRENCY } from "../hashing/fileHash";
import * as MediaStore from "./MediaStore";

const BATCH_SIZE = 200;

// Fire-and-forget pass that fills in media.contentMd5 for rows that don't
// have it yet, off the folder-load critical path. Every file is hashed
// exactly once, ever - later loads just read the memoised value.
// onProgress (attempted, total) - total is snapshotted once up front (see
// MediaStore.countMediaMissingContentMd5); attempted counts every row this
// pass touches, success or failure, so a caller tracking a progress bar
// (pipeline/PipelineRun.js's "hash" stage) always sees it reach total
// instead of stalling on rows that fail to hash.
export const backfillContentMd5 = async (onProgress?: (attempted: number, total: number) => void): Promise<void> => {
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
            const batch = MediaStore.mediaMissingContentMd5(BATCH_SIZE, afterRowid);
            if (batch.length === 0) break;
            afterRowid = batch[batch.length - 1].rowid;

            let cursor = 0;
            const runWorker = async (): Promise<void> => {
                while (cursor < batch.length) {
                    const row = batch[cursor++];
                    try {
                        const contentMd5 = await fileMd5(row.localPath);
                        if (contentMd5) MediaStore.setContentMd5(row.id, contentMd5);
                        else console.log("backfillContentMd5: skipping", row.localPath, "- unreadable or no longer exists");
                    } catch (error) {
                        console.error("backfillContentMd5 failed for", row.localPath, "-", (error as Error).message);
                    } finally {
                        attempted++;
                        if (onProgress) onProgress(attempted, total);
                    }
                }
            };
            const workerCount = Math.min(FILE_HASH_CONCURRENCY, batch.length);
            await Promise.all(Array.from({ length: workerCount }, runWorker));
        }
    } catch (error) {
        console.error("backfillContentMd5 aborted:", (error as Error).message);
    }
};
