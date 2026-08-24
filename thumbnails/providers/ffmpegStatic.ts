import fs from "fs";
import { execFile, execFileSync, ExecFileException } from "child_process";
import ffmpegStaticPath from "ffmpeg-static";

import type { ThumbnailProvider } from "../../types/domain";

type ExecError = ExecFileException & { stderr?: string };

let ffmpegPath: string | null = null;
try {
    ffmpegPath = ffmpegStaticPath;
    // the binary cannot be executed from inside the asar archive
    if (ffmpegPath) ffmpegPath = ffmpegPath.replace("app.asar", "app.asar.unpacked");
} catch {
    ffmpegPath = null;
}

const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;

// ffmpeg always exits non-zero when given no output, but still logs the duration to stderr first
const getDuration = async (input: string): Promise<number | null> => {
    const { stderr } = await run(["-i", input]).catch((err: ExecError) => ({ stdout: "", stderr: err.stderr || "" }));
    const match = String(stderr).match(DURATION_RE);
    if (!match) return null;
    const [, h, m, s] = match;
    const seconds = (Number(h) * 3600) + (Number(m) * 60) + Number(s);
    return seconds > 0 ? seconds : null;
};

const getDurationSync = (input: string): number | null => {
    let stderr = "";
    try {
        execFileSync(ffmpegPath as string, ["-i", input], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
        stderr = ((error as ExecError).stderr || "").toString();
    }
    const match = stderr.match(DURATION_RE);
    if (!match) return null;
    const [, h, m, s] = match;
    const seconds = (Number(h) * 3600) + (Number(m) * 60) + Number(s);
    return seconds > 0 ? seconds : null;
};

const argsFor = (input: string, output: string, seekSeconds: number): string[] => [
    "-y", "-loglevel", "error",
    ...(seekSeconds ? ["-ss", String(seekSeconds)] : []),
    "-i", input,
    "-frames:v", "1",
    "-vf", "thumbnail,scale=300:-2",
    output,
];

const run = (args: string[]): Promise<{ stdout: string; stderr: string }> => new Promise((resolve, reject) => {
    execFile(ffmpegPath as string, args, { encoding: "utf8" }, (error, stdout, stderr) =>
        error ? reject(Object.assign(error, { stderr }) as ExecError) : resolve({ stdout, stderr })
    );
});

const ffmpegStaticProvider: ThumbnailProvider & { name: "ffmpeg-static" } = {
    name: "ffmpeg-static",

    isAvailable: () => Boolean(ffmpegPath && fs.existsSync(ffmpegPath)),

    // Seeks to 90% of the video's duration (10% before the end) so the
    // thumbnail isn't a black/title frame from the very start. Videos whose
    // duration can't be probed, or where that offset yields no frame, fall
    // back to no seek at all.
    generate: async (input: string, output: string): Promise<void> => {
        const duration = await getDuration(input);
        const seek = duration ? duration * 0.9 : 0;
        await run(argsFor(input, output, seek));
        if (!fs.existsSync(output)) {
            await run(argsFor(input, output, 0));
        }
    },

    generateSync: (input: string, output: string): void => {
        const duration = getDurationSync(input);
        const seek = duration ? duration * 0.9 : 0;
        execFileSync(ffmpegPath as string, argsFor(input, output, seek), { encoding: "utf8" });
        if (!fs.existsSync(output)) {
            execFileSync(ffmpegPath as string, argsFor(input, output, 0), { encoding: "utf8" });
        }
    },
};

export default ffmpegStaticProvider;
