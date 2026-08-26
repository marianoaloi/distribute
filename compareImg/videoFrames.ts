import fs from "fs";
import path from "path";
import { execFile, execFileSync, ExecFileException } from "child_process";
import { getFramesDir, ensureFramesDir } from "./cache";
import { hashFor } from "../thumbnails/cache";
import { ffmpegPath } from "./ffmpegBinary";
import { memoryAwareLimit, TASK_MEMORY_ESTIMATE } from "../system/resourceLimits";

import type { Semaphore, VideoFrame } from "../types/domain";
import { get } from "http";

type ExecError = ExecFileException & { stderr?: string };

// Neither runCapture (duration probe, audio-stream probe) nor
// extractFramesFFMPEG had any bound on how long ffmpeg could run - a
// malformed/unusual input (e.g. a stream ffmpeg's probe blocks on) could
// leave the child process running forever with the awaiting promise never
// settling and nothing logged, silently wedging one of
// FRAME_EXTRACTION_CONCURRENCY's concurrent slots (and, upstream, one of
// indexMediaBackground's ITEM_CONCURRENCY workers) with zero visible error.
// Node's execFile kills the child and calls back with an error once this
// elapses, so a bad file becomes a loud, specific, recoverable failure
// instead of a permanent freeze.
const PROBE_TIMEOUT_MS = 90_000;
const EXTRACT_TIMEOUT_MS = 180_000;

export { isAvailable } from "./ffmpegBinary";

const runCapture = (args: string[]): Promise<{ error: ExecFileException | null; stdout: string; stderr: string }> =>
    new Promise((resolve) => {
        execFile(ffmpegPath as string, args, { encoding: "utf8", timeout: PROBE_TIMEOUT_MS }, (error, stdout, stderr) => {
            resolve({ error, stdout, stderr: stderr || "" });
        });
    });

const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;

// ffmpeg always exits non-zero when given no output, but still logs the duration to stderr first
export const getDuration = async (input: string): Promise<number | null> => {
    const { stderr } = await runCapture(["-i", input]);
    const match = stderr.match(DURATION_RE);
    if (!match) return null;
    const [, h, m, s] = match;
    const seconds = (Number(h) * 3600) + (Number(m) * 60) + Number(s);
    return seconds > 0 ? seconds : null;
};

// ffmpeg -i's stderr lists one "Stream #i:j[...]: <Type>: ..." line per stream
const AUDIO_STREAM_RE = /Stream #\d+:\d+.*:\s*Audio/;

export const hasAudio = async (input: string): Promise<boolean> => {
    const { stderr } = await runCapture(["-i", input]);
    return AUDIO_STREAM_RE.test(stderr);
};

// ffmpeg always exits non-zero when given no output; the stream info is on
// stderr regardless, so read it off the thrown error instead of stdout.
export const hasAudioSync = (input: string): boolean => {
    try {
        execFileSync(ffmpegPath as string, ["-i", input], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        return false;
    } catch (error) {
        return AUDIO_STREAM_RE.test(((error as ExecError).stderr || "").toString());
    }
};

interface Timestamps {
    start10s: number;
    end10s: number;
    pct50: number;
    pct10: number;
}

// Spec: 10s after begin, 10s before end, 50% and 10% of duration
const timestampsFor = (duration: number): Timestamps => ({
    start10s: Math.min(10, duration),
    end10s: Math.max(duration - 10, 0),
    pct50: duration * 0.5,
    pct10: duration * 0.1,
});

export const FRAME_POSITIONS = ["start10s", "end10s", "pct50", "pct10"] as const;

export const framePathFor = (input: string, position: string): string => path.join(getFramesDir(), `${hashFor(input)}_${position}.jpg`);


const extractFramesFFMPEG = (
    input: string,
    frames: Array<{ seconds: number; position: "start10s" | "end10s" | "pct50" | "pct10"; path: string; }>): Promise<void> =>
        new Promise((resolve, reject) => {
    if (frames.length === 0) return resolve();

    const splitLabels = frames.map((_, i) => `[v${i + 1}]`).join('');
    const selects = frames.map((f, i) => `[v${i + 1}]select='gte(t\\,${f.seconds})'[out${i + 1}]`).join('; ');
    const filterComplex = `[0:v]split=${frames.length}${splitLabels}; ${selects}`;

    const args = ["-y", "-loglevel", "error", "-i", input, "-filter_complex", filterComplex];
    frames.forEach((f, i) => args.push("-map", `[out${i + 1}]`, "-frames:v", "1", f.path));

    execFile(ffmpegPath as string, args, { encoding: "utf8", timeout: EXTRACT_TIMEOUT_MS }, (error) => error ? reject(error) : resolve());
});

// indexMediaBackground now processes several media items concurrently
// (ITEM_CONCURRENCY_CEILING in mediaIndexer.js), and multiple rebuild calls
// could also overlap, so cap how many video frame-extraction pipelines
// (each spawning ffmpeg) run at once; extras queue and start as a slot
// frees up. This is the ceiling free RAM is allowed to pull down from (see
// resourceLimits.ts) - 55 concurrent ffmpeg processes is the single biggest
// contributor to the oversubscription this module's timeouts exist to
// recover from, so this is the cap most worth making memory-aware.
const FRAME_EXTRACTION_CONCURRENCY_CEILING = 55;
const resolveFrameExtractionLimit = (): number =>
    memoryAwareLimit(FRAME_EXTRACTION_CONCURRENCY_CEILING, TASK_MEMORY_ESTIMATE.ffmpegFrameExtraction);

// limit is re-read on every acquire/release (rather than fixed at creation)
// so a run that starts with headroom and eats into it over time throttles
// down mid-run - a newly queued waiter honors whatever the cap currently is,
// though anything already dispatched keeps running (this only ever holds
// back the START of new work, never preempts work in flight).
const createSemaphore = (resolveLimit: () => number): Semaphore => {
    let active = 0;
    const queue: Array<() => void> = [];
    const dispatchQueued = (): void => {
        if (queue.length === 0 || active >= resolveLimit()) return;
        active++;
        (queue.shift() as () => void)();
    };
    const acquire = (): Promise<void> => {
        if (active < resolveLimit()) {
            active++;
            return Promise.resolve();
        }
        return new Promise<void>(resolve => queue.push(resolve));
    };
    const release = (): void => {
        active--;
        dispatchQueued();
    };
    return { acquire, release };
};

const frameExtractionLimiter = createSemaphore(resolveFrameExtractionLimit);

const existingFramesFor = (input: string): VideoFrame[] => FRAME_POSITIONS
    .map(position => ({ position, path: framePathFor(input, position) }))
    .filter(frame => fs.existsSync(frame.path));

// Read-only variant of extractFrames for callers that only want whatever's
// already been extracted (e.g. the duplicates grid's frame-collage
// thumbnail) - never spawns ffmpeg, so it's safe to call on every render.
export const frameSetForMedia = (localPath: string): VideoFrame[] => existingFramesFor(localPath);

// Returns [{ position, path, seconds }] for frames it managed to extract; skips ones ffmpeg can't produce.
// Always probes duration (even when every frame is already cached on disk) since that's the only
// source for each frame's timestamp - a single "ffmpeg -i" duration probe is far cheaper than the
// filter_complex extraction it lets us skip, so the re-scan fast path stays cheap either way.
export const extractFrames = async (input: string): Promise<VideoFrame[]> => {
    const cached = existingFramesFor(input);

    await frameExtractionLimiter.acquire();
    try {
        const duration = await getDuration(input);
        if (!duration) return [];

        const timestamps = timestampsFor(duration);
        const withSeconds = (frame: VideoFrame): VideoFrame => ({ ...frame, seconds: timestamps[frame.position as keyof Timestamps] });

        if (cached.length === FRAME_POSITIONS.length) return cached.map(withSeconds);

        ensureFramesDir();
        const frames: VideoFrame[] = cached.map(withSeconds);

        const all = FRAME_POSITIONS
            .filter(position => !cached.some(f => f.position === position))
            .map(position => ({ position, path: framePathFor(input, position) }))
            .map(position => ({ ...position, seconds: timestamps[position.position] }));

        frames.push(...await getFramesFromFfmpeg(input, all));
        return frames;
    } finally {
        frameExtractionLimiter.release();
    }
};

async function getFramesFromFfmpeg(
    input: string,
    frames: Array<{ seconds: number;  position: "start10s" | "end10s" | "pct50" | "pct10"; path: string; }>
): Promise<VideoFrame[]> {
    const extracted: VideoFrame[] = [];

    try {
        await extractFramesFFMPEG(input, frames);
        extracted.push(...frames.filter(f => fs.existsSync(f.path)).map(f => ({ position: f.position, path: f.path, seconds: f.seconds })));
    } catch (error) {
        console.error(`Frame extraction failed for ${input} @ ${frames.map(f => f.position).join(', ')}:`, (error as Error).message);
    }

    return extracted;
}

