const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { framesDir, ensureFramesDir } = require("./cache");
const { hashFor } = require("../thumbnails/cache");

let ffmpegPath = null;
try {
    ffmpegPath = require("ffmpeg-static");
    // the binary cannot be executed from inside the asar archive
    if (ffmpegPath) ffmpegPath = ffmpegPath.replace("app.asar", "app.asar.unpacked");
} catch {
    ffmpegPath = null;
}

const isAvailable = () => Boolean(ffmpegPath && fs.existsSync(ffmpegPath));

const runCapture = (args) => new Promise((resolve) => {
    execFile(ffmpegPath, args, { encoding: "UTF-8" }, (error, stdout, stderr) => {
        resolve({ error, stdout, stderr: stderr || "" });
    });
});

const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;

// ffmpeg always exits non-zero when given no output, but still logs the duration to stderr first
const getDuration = async (input) => {
    const { stderr } = await runCapture(["-i", input]);
    const match = stderr.match(DURATION_RE);
    if (!match) return null;
    const [, h, m, s] = match;
    const seconds = (Number(h) * 3600) + (Number(m) * 60) + Number(s);
    return seconds > 0 ? seconds : null;
};

// Spec: 10s after begin, 10s before end, 50% and 10% of duration
const timestampsFor = (duration) => ({
    start10s: Math.min(10, duration),
    end10s: Math.max(duration - 10, 0),
    pct50: duration * 0.5,
    pct10: duration * 0.1,
});

const FRAME_POSITIONS = ["start10s", "end10s", "pct50", "pct10"];

const framePathFor = (input, position) => path.join(framesDir, `${hashFor(input)}_${position}.jpg`);

const extractFrame = (input, output, seconds) => new Promise((resolve, reject) => {
    const args = ["-y", "-loglevel", "error", "-ss", String(seconds), "-i", input, "-frames:v", "1", output];
    execFile(ffmpegPath, args, { encoding: "UTF-8" }, (error) => error ? reject(error) : resolve());
});

// Returns [{ position, path }] for frames it managed to extract; skips ones ffmpeg can't produce
const extractFrames = async (input) => {
    const duration = await getDuration(input);
    if (!duration) return [];

    ensureFramesDir();
    const timestamps = timestampsFor(duration);
    const frames = [];
    for (const position of FRAME_POSITIONS) {
        const output = framePathFor(input, position);
        if (!fs.existsSync(output)) {
            try {
                await extractFrame(input, output, timestamps[position]);
            } catch (error) {
                console.error(`Frame extraction failed for ${input} @ ${position}:`, error.message);
                continue;
            }
        }
        if (fs.existsSync(output)) frames.push({ position, path: output });
    }
    return frames;
};

module.exports = {
    isAvailable,
    getDuration,
    extractFrames,
    FRAME_POSITIONS,
};
