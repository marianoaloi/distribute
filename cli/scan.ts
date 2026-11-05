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
    skippedSymlinkDirs: number;
    unreadableFolders: number;
    stopped: boolean;
}

export interface ScanOptions {
    shouldStop(): boolean;
    onProgress?(stats: ScanStats): void;
}

export const scanTree = async (root: string, options: ScanOptions): Promise<ScanStats> => {
    const stats: ScanStats = { folders: 0, media: 0, skippedSymlinkDirs: 0, unreadableFolders: 0, stopped: false };
    const countItems = (items: StreamMediaItem[]): void => { stats.media += items.length; };
    const countOne = (): void => { stats.media += 1; };

    const processChunk = async (dir: string, files: string[]): Promise<void> => {
        if (files.length === 0) return;
        await transformDataStreaming(files, dir, countItems, countOne);
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
                if (entry.isDirectory()) {
                    subdirs.push(path.join(dir, entry.name));
                } else if (entry.isSymbolicLink()) {
                    // A symlink to a folder could loop forever; one to a file
                    // is handed on like any file (it is stat'ed there).
                    let target: fs.Stats | null = null;
                    try { target = fs.statSync(path.join(dir, entry.name)); } catch { /* dangling */ }
                    if (target?.isDirectory()) {
                        stats.skippedSymlinkDirs++;
                        console.warn("lsr scan: skipping symlinked folder", path.join(dir, entry.name));
                    } else {
                        files.push(entry.name);
                    }
                } else {
                    files.push(entry.name);
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
