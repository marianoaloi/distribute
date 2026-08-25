import os from "os";

// Shared by compareImg/computePool.ts, compareImg/mediaIndexer.ts and
// compareImg/videoFrames.ts - their concurrency caps (worker-thread pool
// size, in-flight media items, concurrent ffmpeg extractions) used to be
// sized only from os.cpus().length, which says nothing about whether the
// machine actually has the RAM to run that many at once. On a loaded
// machine (see the 2026-08-25 investigation: 20 cores but ~3GB free) that
// let the pipeline oversubscribe itself into multi-minute stalls that then
// tripped computePool/videoFrames' timeouts - not because any file was bad,
// but because everything was starved for memory at once.
//
// Deliberately generous (worst-case, not average) per-task estimates:
// undercounting risks recreating the exact stall this exists to prevent,
// overcounting only costs some throughput on a well-provisioned machine.
export const TASK_MEMORY_ESTIMATE = {
    // Jimp decodes the FULL-resolution image to an RGBA bitmap before this
    // pipeline's own resize() ever gets to shrink it - a 24MP photo (common
    // in a real library, see the LilyC/*.jpg series from that investigation)
    // decodes to ~96MB before it's cropped down to 48x48, plus decoder
    // overhead. Sized for that, not for this app's own tiny thumbnails.
    pixelHash: 150 * 1024 * 1024,
    // One full ffmpeg child process per concurrent extraction (filter_complex
    // pulling up to 4 frames at once), each with its own decode buffers and
    // process overhead on top.
    ffmpegFrameExtraction: 200 * 1024 * 1024,
    // mediaIndexer's own per-item bookkeeping (DB rows, JS closures) around
    // whichever of the two above it's waiting on - much lighter than either,
    // but still worth capping so a huge library doesn't queue up thousands
    // of "in-flight" items each holding their own small slice of state.
    indexingItem: 40 * 1024 * 1024,
} as const;

// Always leave this much free no matter what the math says - so the rest of
// the app (Electron's renderer/GPU process, the OS, whatever else the user
// has open) never gets starved to zero just because one more concurrent
// task would technically still fit.
const RESERVE_BYTES = 1.5 * 1024 * 1024 * 1024;

// cpuCeiling: whatever the existing core-count-derived (or fixed) cap was -
// the result never exceeds it, memory only ever pulls it down, never raises
// it past that. Reads os.freemem() live on every call rather than caching a
// value computed once at startup, so a run that starts with headroom and
// eats into it over time (its own cache growing, another app opening)
// throttles down mid-run instead of only reflecting conditions from minutes
// ago.
export const memoryAwareLimit = (cpuCeiling: number, bytesPerTask: number): number => {
    const usableBytes = Math.max(0, os.freemem() - RESERVE_BYTES);
    const memoryCeiling = Math.max(1, Math.floor(usableBytes / bytesPerTask));
    return Math.max(1, Math.min(cpuCeiling, memoryCeiling));
};
