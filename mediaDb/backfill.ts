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
        // Rows that fail (e.g. file deleted mid-scan) stay contentMd5-NULL,
        // so the next LIMIT query would return the exact same set forever -
        // stop once a batch makes no progress instead of looping forever.
        let lastBatchKey: string | null = null;
        for (;;) {
            const batch = MediaStore.mediaMissingContentMd5(BATCH_SIZE);
            if (batch.length === 0) break;
            const batchKey = batch.map((r) => r.id).join(",");
            if (batchKey === lastBatchKey) break;
            lastBatchKey = batchKey;

            let cursor = 0;
            const runWorker = async (): Promise<void> => {
                while (cursor < batch.length) {
                    const row = batch[cursor++];
                    try {
                        const contentMd5 = await fileMd5(row.localPath);
                        if (contentMd5) MediaStore.setContentMd5(row.id, contentMd5);
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
