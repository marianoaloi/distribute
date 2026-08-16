// Diagnostic tool for the "duplicate finder" feature (compareImg/*).
//
// Runs the exact same two pipelines the app uses to flag duplicates against
// two videos given on the command line, and dumps every intermediate image
// (raw extracted frame, cropped 60x60 greyscale base, each blur level) plus
// a report into a debug folder, so a human can see *why* two videos were or
// weren't flagged as duplicates instead of only seeing a yes/no.
//
// Usage:
//   node scripts/debugCompareVideos.js <videoA> <videoB> [outDir]
//
// outDir defaults to debug/<timestamp>/ under the project root.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Jimp } from "jimp";

import { extractFrames, FRAME_POSITIONS } from "../compareImg/videoFrames";
import {
    toBaseImage,
    greyscaleChannel,
    boxBlur,
    hashBuffer,
    BLUR_LEVELS,
} from "../compareImg/imageTransform";

// Mirrors compareImg/duplicateFinder.js's contentHashFor exactly. Not
// imported from there directly because duplicateFinder.js pulls in
// HashStore.js -> better-sqlite3, which is rebuilt against Electron's ABI
// (see package.json "postinstall") and will fail to load under plain `node`.
const contentHashFor = (filepath: string): Promise<string> => new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(filepath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
});

const HASH_COLUMNS = ["baseMd5", ...BLUR_LEVELS.map((level) => `blur_${level}`)];

interface PixelDiffStats {
    meanAbsDiff: number;
    maxAbsDiff: number;
    pctIdentical: number;
    pctWithin2: number;
}

// Numeric similarity between two equal-length grey-pixel buffers, as an
// alternative to MD5 equality: MD5 has the avalanche property (any single
// pixel off by 1 produces a totally unrelated hash), so it can never express
// "these are 99% the same image" - only "identical" or "unrelated". This is
// what the app's matching logic is missing entirely.
const pixelDiffStats = (a: Uint8Array, b: Uint8Array): PixelDiffStats => {
    let sumAbs = 0;
    let maxAbs = 0;
    let identical = 0;
    let within2 = 0;
    for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        sumAbs += d;
        if (d > maxAbs) maxAbs = d;
        if (d === 0) identical++;
        if (d <= 2) within2++;
    }
    const n = a.length;
    return {
        meanAbsDiff: sumAbs / n,
        maxAbsDiff: maxAbs,
        pctIdentical: (identical / n) * 100,
        pctWithin2: (within2 / n) * 100,
    };
};

const safeStem = (filePath: string): string => path.basename(filePath, path.extname(filePath))
    .replace(/[^a-z0-9_-]+/gi, "_")
    .slice(0, 60);

const saveGreyBuffer = async (buffer: Uint8Array, width: number, height: number, outPath: string): Promise<void> => {
    const img = new Jimp({ width, height, color: 0x000000ff });
    const data = img.bitmap.data;
    for (let i = 0; i < buffer.length; i++) {
        data[i * 4] = buffer[i];
        data[i * 4 + 1] = buffer[i];
        data[i * 4 + 2] = buffer[i];
        data[i * 4 + 3] = 255;
    }
    await img.write(outPath as `${string}.${string}`);
};

interface BlurResult {
    md5: string;
    image: string;
}

interface FrameResult {
    position: string;
    rawFrame: string;
    baseImage: string;
    baseMd5: string;
    blurs: Record<string, BlurResult>;
    // Underscore-prefixed: raw pixel buffers kept only for pixelDiffStats
    // in main(), stripped before the JSON report is written.
    _baseBuffer: Uint8Array;
    _blurBuffers: Record<string, Uint8Array>;
}

interface VideoResult {
    videoPath: string;
    label: string;
    stem: string;
    frames: FrameResult[];
}

// Runs both hash pipelines for one video: extracts its 4 frames, saves the
// raw frame + the transformed images for each, and returns the per-frame
// hash values keyed the same way HashStore/duplicateFinder key them.
const processVideo = async (videoPath: string, label: string, outDir: string): Promise<VideoResult> => {
    const stem = safeStem(videoPath);
    const frames = await extractFrames(videoPath);
    if (frames.length === 0) {
        console.warn(`[${label}] no frames could be extracted from ${videoPath} (corrupt file? ffmpeg missing?)`);
    }

    const frameResults: FrameResult[] = [];
    for (const { position, path: framePath } of frames) {
        const rawOut = path.join(outDir, `${label}_${stem}_${position}_raw.jpg`);
        fs.copyFileSync(framePath, rawOut);

        const base = await toBaseImage(framePath);
        const baseMd5 = hashBuffer(Buffer.from(base.bitmap.data));
        const baseOut = path.join(outDir, `${label}_${stem}_${position}_base60.png`);
        await base.write(baseOut as `${string}.${string}`);

        const { width, height } = base.bitmap;
        const grey = greyscaleChannel(base);

        const blurs: Record<string, BlurResult> = {};
        const blurBuffers: Record<string, Uint8Array> = {};
        for (const level of BLUR_LEVELS) {
            const blurred = boxBlur(grey, width, height, level);
            const blurMd5 = hashBuffer(Buffer.from(blurred));
            const blurOut = path.join(outDir, `${label}_${stem}_${position}_blur${level}.png`);
            await saveGreyBuffer(blurred, width, height, blurOut);
            blurs[`blur_${level}`] = { md5: blurMd5, image: path.basename(blurOut) };
            blurBuffers[`blur_${level}`] = blurred;
        }

        frameResults.push({
            position,
            rawFrame: path.basename(rawOut),
            baseImage: path.basename(baseOut),
            baseMd5,
            blurs,
            _baseBuffer: grey,
            _blurBuffers: blurBuffers,
        });
    }

    return { videoPath, label, stem, frames: frameResults };
};

interface FrameMatch {
    column: string;
    positionA: string;
    positionB: string;
    value: string;
}

// Cross-product every frame of A against every frame of B, for every hash
// column, exactly like duplicateFinder.findIndexDuplicates does (it does not
// restrict matches to the same frame position - a match on ANY column
// between ANY two frames is enough to flag the whole pair as duplicates).
const compareFrames = (videoA: VideoResult, videoB: VideoResult): FrameMatch[] => {
    const matches: FrameMatch[] = [];
    for (const frameA of videoA.frames) {
        for (const frameB of videoB.frames) {
            for (const column of HASH_COLUMNS) {
                const valueA = column === "baseMd5" ? frameA.baseMd5 : frameA.blurs[column].md5;
                const valueB = column === "baseMd5" ? frameB.baseMd5 : frameB.blurs[column].md5;
                if (valueA === valueB) {
                    matches.push({ column, positionA: frameA.position, positionB: frameB.position, value: valueA });
                }
            }
        }
    }
    return matches;
};

interface DiffStatsEntry {
    position: string;
    base: PixelDiffStats;
    blurs: Record<string, PixelDiffStats>;
}

interface Report {
    videoA: VideoResult;
    videoB: VideoResult;
    contentHashA: string;
    contentHashB: string;
    contentIdentical: boolean;
    matches: FrameMatch[];
    diffStats: DiffStatsEntry[];
}

// One block per timestamp (start10s first, matching FRAME_POSITIONS order):
// a row for A's images at that timestamp, a row for B's (md5 under each
// image), then a "diff" row with the pixelDiffStats between A and B for
// that column - showing the numeric similarity that MD5 equality throws away.
const buildHtmlReport = (report: Report): string => {
    const frameFor = (video: VideoResult, position: string) => video.frames.find((f) => f.position === position);
    const statsFor = (position: string) => report.diffStats.find((d) => d.position === position);

    const imgCell = (file: string | null, md5: string | null) => `
        <td>
            ${file ? `<img src="${file}" loading="lazy">` : "<em>missing</em>"}
            ${md5 ? `<code>${md5}</code>` : ""}
        </td>`;

    const rowFor = (video: VideoResult, frame: FrameResult | undefined) => {
        if (!frame) {
            return `<tr><th class="rowlabel">${video.label}</th><td colspan="${BLUR_LEVELS.length + 2}"><em>frame not extracted</em></td></tr>`;
        }
        const cells = [
            imgCell(frame.rawFrame, null),
            imgCell(frame.baseImage, frame.baseMd5),
            ...BLUR_LEVELS.map((level) => imgCell(frame.blurs[`blur_${level}`].image, frame.blurs[`blur_${level}`].md5)),
        ];
        return `<tr><th class="rowlabel">${video.label}</th>${cells.join("")}</tr>`;
    };

    const diffCell = (stats: PixelDiffStats | undefined) => stats
        ? `<td class="diffcell">mean|&Delta;|=${stats.meanAbsDiff.toFixed(2)}<br>max=${stats.maxAbsDiff}<br>ident=${stats.pctIdentical.toFixed(1)}%<br>&plusmn;2=${stats.pctWithin2.toFixed(1)}%</td>`
        : `<td class="diffcell">-</td>`;

    const diffRow = (stats: DiffStatsEntry | undefined) => {
        if (!stats) return "";
        const cells = [
            `<td class="diffcell">-</td>`,
            diffCell(stats.base),
            ...BLUR_LEVELS.map((level) => diffCell(stats.blurs[`blur_${level}`])),
        ];
        return `<tr><th class="rowlabel">A vs B</th>${cells.join("")}</tr>`;
    };

    const positionBlock = (position: string) => `
        <h2>${position}</h2>
        <table>
            <tr><th></th><th>raw frame</th><th>base60</th>${BLUR_LEVELS.map((l) => `<th>blur_${l}</th>`).join("")}</tr>
            ${rowFor(report.videoA, frameFor(report.videoA, position))}
            ${rowFor(report.videoB, frameFor(report.videoB, position))}
            ${diffRow(statsFor(position))}
        </table>`;

    const matchRows = report.matches.length
        ? report.matches.map((m) => `<tr><td>${m.column}</td><td>${m.positionA}</td><td>${m.positionB}</td><td><code>${m.value}</code></td></tr>`).join("")
        : `<tr><td colspan="4"><em>No column matched on any frame pair - the app would NOT flag these as duplicates via the perceptual index.</em></td></tr>`;

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Duplicate-finder debug report</title>
<style>
body { font-family: system-ui, sans-serif; margin: 20px; }
table { border-collapse: collapse; margin-bottom: 24px; }
td, th { border: 1px solid #ccc; padding: 6px; vertical-align: top; text-align: center; font-size: 12px; }
th.rowlabel { font-size: 16px; text-align: center; }
img { width: 140px; image-rendering: pixelated; display: block; margin: 0 auto; }
code { font-size: 10px; word-break: break-all; display: block; margin-top: 4px; }
.verdict { font-size: 16px; padding: 10px; margin-bottom: 16px; }
.dup { background: #ffdede; } .nodup { background: #ddffdd; }
.paths { font-size: 13px; margin-bottom: 16px; }
.diffcell { text-align: left; font-size: 10px; background: #f5f5f5; }
</style></head>
<body>
<h1>Duplicate-finder debug report</h1>
<div class="paths">
    A: ${report.videoA.videoPath}<br>
    B: ${report.videoB.videoPath}
</div>
<div class="verdict ${report.contentIdentical || report.matches.length ? "dup" : "nodup"}">
    Exact byte-for-byte duplicate (contentHashFor): <b>${report.contentIdentical ? "YES" : "NO"}</b><br>
    A content MD5: <code>${report.contentHashA}</code><br>
    B content MD5: <code>${report.contentHashB}</code><br>
    Perceptual index match (findIndexDuplicates logic): <b>${report.matches.length ? "YES - " + report.matches.length + " column match(es)" : "NO"}</b>
</div>
<h2>Column matches (any one of these makes duplicateFinder.js flag the pair)</h2>
<table><tr><th>column</th><th>A position</th><th>B position</th><th>shared md5</th></tr>${matchRows}</table>
${FRAME_POSITIONS.map(positionBlock).join("")}
</body></html>`;
};

const main = async (): Promise<void> => {
    const [videoAArg, videoBArg, outDirArg] = process.argv.slice(2);
    if (!videoAArg || !videoBArg) {
        console.error("Usage: node scripts/debugCompareVideos.js <videoA> <videoB> [outDir]");
        process.exit(1);
    }
    const videoA = path.resolve(videoAArg);
    const videoB = path.resolve(videoBArg);
    for (const p of [videoA, videoB]) {
        if (!fs.existsSync(p)) {
            console.error(`File not found: ${p}`);
            process.exit(1);
        }
    }

    const outDir = outDirArg
        ? path.resolve(outDirArg)
        // Compiled to electron-dist/scripts/, two levels below the repo root
        // (unlike the old scripts/debugCompareVideos.js, which was one level
        // down) - go up two to keep landing debug output at <repo>/debug.
        : path.join(__dirname, "..", "..", "debug", new Date().toISOString().replace(/[:.]/g, "-"));
    fs.mkdirSync(outDir, { recursive: true });

    console.log(`Comparing:\n  A: ${videoA}\n  B: ${videoB}\nOutput: ${outDir}\n`);

    const [contentHashA, contentHashB] = await Promise.all([contentHashFor(videoA), contentHashFor(videoB)]);
    const contentIdentical = contentHashA === contentHashB;
    console.log(`Content MD5 A: ${contentHashA}`);
    console.log(`Content MD5 B: ${contentHashB}`);
    console.log(`Byte-identical: ${contentIdentical}\n`);

    console.log("Extracting frames and computing perceptual hashes for A...");
    const resultA = await processVideo(videoA, "A", outDir);
    console.log("Extracting frames and computing perceptual hashes for B...");
    const resultB = await processVideo(videoB, "B", outDir);

    const matches = compareFrames(resultA, resultB);
    console.log(`\nColumn matches found: ${matches.length}`);
    for (const m of matches) {
        console.log(`  column=${m.column} A@${m.positionA} == B@${m.positionB} (${m.value})`);
    }
    if (matches.length === 0) {
        console.log("  (none - the app's findIndexDuplicates would NOT flag this pair)");
    }

    // Same-timestamp pixel-similarity, independent of MD5: how close A and B
    // actually are at each blur level, even when no hash matched.
    const diffStats: DiffStatsEntry[] = [];
    for (const position of FRAME_POSITIONS) {
        const frameA = resultA.frames.find((f) => f.position === position);
        const frameB = resultB.frames.find((f) => f.position === position);
        if (!frameA || !frameB) continue;
        const blurs: Record<string, PixelDiffStats> = {};
        for (const level of BLUR_LEVELS) {
            blurs[`blur_${level}`] = pixelDiffStats(frameA._blurBuffers[`blur_${level}`], frameB._blurBuffers[`blur_${level}`]);
        }
        diffStats.push({ position, base: pixelDiffStats(frameA._baseBuffer, frameB._baseBuffer), blurs });
    }
    console.log("\nPixel-similarity (A vs B, same timestamp - ignores MD5 entirely):");
    for (const stat of diffStats) {
        console.log(`  ${stat.position} base60: mean|diff|=${stat.base.meanAbsDiff.toFixed(2)} max=${stat.base.maxAbsDiff} identical=${stat.base.pctIdentical.toFixed(1)}% within2=${stat.base.pctWithin2.toFixed(1)}%`);
    }

    const stripPrivate = (key: string, value: unknown) => (key.startsWith("_") ? undefined : value);
    const report: Report = {
        videoA: resultA,
        videoB: resultB,
        contentHashA,
        contentHashB,
        contentIdentical,
        matches,
        diffStats,
    };

    fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, stripPrivate, 2));
    fs.writeFileSync(path.join(outDir, "report.html"), buildHtmlReport(report));

    console.log(`\nWrote report.json and report.html to ${outDir}`);
    console.log(`Open ${path.join(outDir, "report.html")} in a browser to inspect the images side by side.`);
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
