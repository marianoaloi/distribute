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

const argsFor = (input, output, seek) => [
    "-y", "-loglevel", "error",
    ...(seek ? ["-ss", "1"] : []),
    "-i", input,
    "-frames:v", "1",
    "-vf", "thumbnail,scale=300:-2",
    output,
];

const run = (args) => new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { encoding: "UTF-8" }, (error) =>
        error ? reject(error) : resolve()
    );
});

module.exports = {
    name: "ffmpeg-static",

    isAvailable: () => Boolean(ffmpegPath && fs.existsSync(ffmpegPath)),

    // videos shorter than the seek offset yield no frame: retry from the start
    generate: async (input, output) => {
        await run(argsFor(input, output, true));
        if (!fs.existsSync(output)) {
            await run(argsFor(input, output, false));
        }
    },

    generateSync: (input, output) => {
        execFileSync(ffmpegPath, argsFor(input, output, true), { encoding: "UTF-8" });
        if (!fs.existsSync(output)) {
            execFileSync(ffmpegPath, argsFor(input, output, false), { encoding: "UTF-8" });
        }
    },
};
