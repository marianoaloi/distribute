// Headless replacement for app.ts's openfileRecursive: walks <root>
// depth-first with an explicit stack (no recursion, no parallel fan-out over
// sibling folders), one folder at a time, so memory stays bounded by one
// chunk of one folder's entries however big the tree is. Each folder's files
// go through the same util.transformDataStreaming pipeline the GUI uses
// (stat/mime, media upsert, video/gif frame extraction) - only the renderer
// callbacks are replaced by counters.
//
// Resumable by construction: upsertMedia is idempotent and an unchanged
// video/gif with cached frames skips ffmpeg, so re-running after a stop only
// costs a stat per already-seen file.
import fs from "fs";
import path from "path";
import { TMP_FOLDER_NAME } from "../DirectorioCache";
import { transformDataStreaming } from "../util";
import type { StreamMediaItem } from "../types/domain";

// Files handed to transformDataStreaming per call: a single folder can hold
// hundreds of thousands of entries.
export const FILE_CHUNK = 5000;

export interface ScanStats {
    folders: number;
    media: number;
    // Symlinks are never followed nor scanned: a link to a folder can loop,
    // and a link to a file would form a "duplicate" of its own target in
    // which the decision report could mark the real file as removable.
    skippedSymlinks: number;
    // FIFOs, sockets, devices: reading one can block forever.
    skippedSpecial: number;
    unreadableFolders: number;
    stopped: boolean;
}

export interface ScanOptions {
    shouldStop(): boolean;
    onProgress?(stats: ScanStats): void;
}

export const scanTree = async (root: string, options: ScanOptions): Promise<ScanStats> => {
    const stats: ScanStats = { folders: 0, media: 0, skippedSymlinks: 0, skippedSpecial: 0, unreadableFolders: 0, stopped: false };
    // Reported per item batch, not only per folder: one folder of thousands
    // of videos can take long, and the run's stall watchdog listens here.
    const countItems = (items: StreamMediaItem[]): void => { stats.media += items.length; options.onProgress?.(stats); };
    const countOne = (): void => { stats.media += 1; options.onProgress?.(stats); };

    const processChunk = async (dir: string, files: string[]): Promise<void> => {
        if (files.length === 0) return;
        // backfill: false - the "hash" stage runs that pass once, afterwards.
        await transformDataStreaming(files, dir, countItems, countOne, undefined, {}, { backfill: false });
        options.onProgress?.(stats);
    };

    const stack: string[] = [root];
    while (stack.length > 0) {
        if (options.shouldStop()) { stats.stopped = true; break; }
        const dir = stack.pop() as string;
        const subdirs: string[] = [];
        let files: string[] = [];
        try {
            const handle = await fs.promises.opendir(dir);
            for await (const entry of handle) {
                // Same rule as the GUI: the app's own tmp/ folder is skipped
                // at every depth.
                if (entry.name === TMP_FOLDER_NAME) continue;
                // Some filesystems report no entry type (DT_UNKNOWN): every
                // is*() is then false, so ask lstat instead of guessing.
                let kind: { isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean } = entry;
                if (!entry.isSymbolicLink() && !entry.isDirectory() && !entry.isFile()
                    && !entry.isFIFO() && !entry.isSocket() && !entry.isCharacterDevice() && !entry.isBlockDevice()) {
                    try { kind = fs.lstatSync(path.join(dir, entry.name)); } catch { continue; /* vanished */ }
                }
                if (kind.isSymbolicLink()) {
                    stats.skippedSymlinks++;
                    console.log("lsr scan: skipping symlink", path.join(dir, entry.name));
                } else if (kind.isDirectory()) {
                    subdirs.push(path.join(dir, entry.name));
                } else if (kind.isFile()) {
                    files.push(entry.name);
                } else {
                    stats.skippedSpecial++;
                    console.warn("lsr scan: skipping special file (fifo/socket/device)", path.join(dir, entry.name));
                }
                if (files.length >= FILE_CHUNK) {
                    await processChunk(dir, files);
                    files = [];
                    if (options.shouldStop()) break;
                }
            }
        } catch (error) {
            // Moved/deleted since its parent listed it, or no permission.
            stats.unreadableFolders++;
            console.error("lsr scan: cannot read folder", dir, "-", (error as Error).message);
        }
        if (options.shouldStop()) { stats.stopped = true; break; }
        await processChunk(dir, files);
        stats.folders++;
        options.onProgress?.(stats);
        // Reverse so folders are visited in listing order.
        for (let i = subdirs.length - 1; i >= 0; i--) stack.push(subdirs[i]);
    }
    return stats;
};
