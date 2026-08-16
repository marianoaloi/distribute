import fs from "fs";
import path from "path";
import { execFile, execFileSync, ExecFileException } from "child_process";
import { getFramesDir, ensureFramesDir } from "./cache";
import { hashFor } from "../thumbnails/cache";
import ffmpegStaticPath from "ffmpeg-static";

import type { Semaphore, VideoFrame } from "../types/domain";
import { get } from "http";

type ExecError = ExecFileException & { stderr?: string };

let ffmpegPath: string | null = null;
try {
    ffmpegPath = ffmpegStaticPath;
    // the binary cannot be executed from inside the asar archive
    if (ffmpegPath) ffmpegPath = ffmpegPath.replace("app.asar", "app.asar.unpacked");
} catch {
    ffmpegPath = null;
}

export const isAvailable = (): boolean => Boolean(ffmpegPath && fs.existsSync(ffmpegPath));

const runCapture = (args: string[]): Promise<{ error: ExecFileException | null; stdout: string; stderr: string }> =>
    new Promise((resolve) => {
        execFile(ffmpegPath as string, args, { encoding: "utf8" }, (error, stdout, stderr) => {
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

const framePathFor = (input: string, position: string): string => path.join(getFramesDir(), `${hashFor(input)}_${position}.jpg`);


const extractFramesFFMPEG = (
    input: string,
    frames: Array<{ seconds: number; exists: boolean; position: "start10s" | "end10s" | "pct50" | "pct10"; path: string; }>): Promise<void> =>
        new Promise((resolve, reject) => {
    if (frames.length === 0) return resolve();

    const splitLabels = frames.map((_, i) => `[v${i + 1}]`).join('');
    const selects = frames.map((f, i) => `[v${i + 1}]select='gte(t\\,${f.seconds})'[out${i + 1}]`).join('; ');
    const filterComplex = `[0:v]split=${frames.length}${splitLabels}; ${selects}`;

    const args = ["-y", "-loglevel", "error", "-i", input, "-filter_complex", filterComplex];
    frames.forEach((f, i) => args.push("-map", `[out${i + 1}]`, "-frames:v", "1", f.path));

    execFile(ffmpegPath as string, args, { encoding: "utf8" }, (error) => error ? reject(error) : resolve());
});

// indexMediaBackground now processes several media items concurrently
// (ITEM_CONCURRENCY in mediaIndexer.js), and multiple rebuild calls could
// also overlap, so cap how many video frame-extraction pipelines (each
// spawning ffmpeg) run at once; extras queue and start as a slot frees up.
const FRAME_EXTRACTION_CONCURRENCY = 55;

const createSemaphore = (limit: number): Semaphore => {
    let active = 0;
    const queue: Array<() => void> = [];
    const acquire = (): Promise<void> => {
        if (active < limit) {
            active++;
            return Promise.resolve();
        }
        return new Promise<void>(resolve => queue.push(resolve)).then(() => { active++; });
    };
    const release = (): void => {
        active--;
        const next = queue.shift();
        if (next) next();
    };
    return { acquire, release };
};

const frameExtractionLimiter = createSemaphore(FRAME_EXTRACTION_CONCURRENCY);

const existingFramesFor = (input: string): VideoFrame[] => FRAME_POSITIONS
    .map(position => ({ position, path: framePathFor(input, position) }))
    .filter(frame => fs.existsSync(frame.path));

// Returns [{ position, path }] for frames it managed to extract; skips ones ffmpeg can't produce
export const extractFrames = async (input: string): Promise<VideoFrame[]> => {
    // All frames already on disk (e.g. re-scanning a folder): just read them
    // back, no need to probe duration or spend a concurrency slot on ffmpeg.
    const cached = existingFramesFor(input);
    if (cached.length === FRAME_POSITIONS.length) return cached;

    await frameExtractionLimiter.acquire();
    try {
        const duration = await getDuration(input);
        if (!duration) return [];

        ensureFramesDir();
        const timestamps = timestampsFor(duration);
        const frames: VideoFrame[] = [];
        // for (const position of FRAME_POSITIONS) {
        //     const output = framePathFor(input, position);
        //     if (!fs.existsSync(output)) {
        //         try {
        //             await extractFrame(input, output, timestamps[position]);
        //         } catch (error) {
        //             console.error(`Frame extraction failed for ${input} @ ${position}:`, (error as Error).message);
        //             continue;
        //         }
        //     }
        //     if (fs.existsSync(output)) frames.push({ position, path: output });
        // }
        const all = FRAME_POSITIONS
            .map(position => ({ position, path: framePathFor(input, position) }))
            .map(position => ({ ...position, seconds: timestamps[position.position], exists: fs.existsSync(position.path) }));
        frames.push(...all.filter(f => f.exists).map(f => ({ position: f.position, path: f.path })));
        if (all.filter(f => !f.exists).length === 0) return frames;
        frames.push(...await getFramesFromFfmpeg(input, all.filter(f => !f.exists)));
        return frames;
    } finally {
        frameExtractionLimiter.release();
    }
};

async function getFramesFromFfmpeg(
    input: string,
    frames: Array<{ seconds: number; exists: boolean; position: "start10s" | "end10s" | "pct50" | "pct10"; path: string; }>
): Promise<VideoFrame[]> {
    const extracted: VideoFrame[] = [];

    try {
        await extractFramesFFMPEG(input, frames);
        extracted.push(...frames.filter(f => fs.existsSync(f.path)).map(f => ({ position: f.position, path: f.path })));
    } catch (error) {
        console.error(`Frame extraction failed for ${input} @ ${frames.map(f => f.position).join(', ')}:`, (error as Error).message);
    }

    return extracted;
}

