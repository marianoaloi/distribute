const fs = require("fs");
const { execFile, execFileSync } = require("child_process");

let ffmpegPath = null;
try {
    ffmpegPath = require("ffmpeg-static");
    // the binary cannot be executed from inside the asar archive
    if (ffmpegPath) ffmpegPath = ffmpegPath.replace("app.asar", "app.asar.unpacked");
} catch {
    ffmpegPath = null;
}

const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;

// ffmpeg always exits non-zero when given no output, but still logs the duration to stderr first
const getDuration = async (input) => {
    const { stderr } = await run(["-i", input]).catch(err => ({ stderr: (err && err.stderr) || "" }));
    const match = String(stderr).match(DURATION_RE);
    if (!match) return null;
    const [, h, m, s] = match;
    const seconds = (Number(h) * 3600) + (Number(m) * 60) + Number(s);
    return seconds > 0 ? seconds : null;
};

const getDurationSync = (input) => {
    let stderr = "";
    try {
        execFileSync(ffmpegPath, ["-i", input], { encoding: "UTF-8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
        stderr = (error.stderr || "").toString();
    }
    const match = stderr.match(DURATION_RE);
    if (!match) return null;
    const [, h, m, s] = match;
    const seconds = (Number(h) * 3600) + (Number(m) * 60) + Number(s);
    return seconds > 0 ? seconds : null;
};

const argsFor = (input, output, seekSeconds) => [
    "-y", "-loglevel", "error",
    ...(seekSeconds ? ["-ss", String(seekSeconds)] : []),
    "-i", input,
    "-frames:v", "1",
    "-vf", "thumbnail,scale=300:-2",
    output,
];

const run = (args) => new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { encoding: "UTF-8" }, (error, stdout, stderr) =>
        error ? reject(Object.assign(error, { stderr })) : resolve({ stdout, stderr })
    );
});

module.exports = {
    name: "ffmpeg-static",

    isAvailable: () => Boolean(ffmpegPath && fs.existsSync(ffmpegPath)),

    // Seeks to 10% of the video's duration so the thumbnail isn't a black/title
    // frame from the very start. Videos whose duration can't be probed, or that
    // are shorter than that offset yields no frame, fall back to no seek at all.
    generate: async (input, output) => {
        const duration = await getDuration(input);
        const seek = duration ? duration * 0.1 : 0;
        await run(argsFor(input, output, seek));
        if (!fs.existsSync(output)) {
            await run(argsFor(input, output, 0));
        }
    },

    generateSync: (input, output) => {
        const duration = getDurationSync(input);
        const seek = duration ? duration * 0.1 : 0;
        execFileSync(ffmpegPath, argsFor(input, output, seek), { encoding: "UTF-8" });
        if (!fs.existsSync(output)) {
            execFileSync(ffmpegPath, argsFor(input, output, 0), { encoding: "UTF-8" });
        }
    },
};
