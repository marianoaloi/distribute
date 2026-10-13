// Reproduces "media moved away while Load super recursive is running".
//
// Runs the same stages as app.ts's loadSuperRecursive chain, headless, against
// a real folder: wipes its index.db, scans it (the "fill the medias" step),
// then moves one image, one gif and one video out of the folder before the
// remaining stages (hash -> index -> detect -> duplicates) run. Every
// console.error, uncaught exception and unhandled rejection is collected, and
// the moved files are always put back at the end.
//
// Usage (must run under Electron - better-sqlite3 is built for its ABI):
//   npx electron electron-dist/scripts/debugMovedMedia.js <folder> <model.maloi> [movedDir] [--move-at=<point>]
//
// --move-at picks WHEN the files disappear (default "between"):
//   between - after the scan, before the other stages (each re-queries the DB)
//   scan    - mid-scan, once the images were emitted but video/gif frames not yet extracted
//   hash    - right after a content-MD5 pass fetched its batch of rows
//   index   - right after buildIndex fetched its media list
//   detect  - right after detection fetched its item list
//
// Exit code 0 = every stage finished with no errors, 1 = errors were seen.

import "../logging/AppLog";
import fs from "fs";
import path from "path";
import { app } from "electron";

import { setActiveFolder, TMP_FOLDER_NAME } from "../DirectorioCache";
import { redirectToActiveFolder } from "../logging/AppLog";
import * as HashStore from "../compareImg/HashStore";
import * as MediaStore from "../mediaDb/MediaStore";
import * as mediaIndexer from "../compareImg/mediaIndexer";
import * as duplicateFinder from "../compareImg/duplicateFinder";
import * as onnxDetector from "../objectDetection/onnxDetector";
import { processMediaToDetections } from "../objectDetection/processImages";
import { backfillContentMd5 } from "../mediaDb/backfill";
import { transformDataStreaming } from "../util";
import { getDbPath, getFramesDir } from "../compareImg/cache";
import { hashFor } from "../thumbnails/cache";

const [folder, maloiPath, movedDirArg] = process.argv.slice(2).filter(a => !a.startsWith("--"));
if (!folder || !maloiPath) {
    console.log("Usage: electron electron-dist/scripts/debugMovedMedia.js <folder> <model.maloi> [movedDir]");
    process.exit(2);
}
const movedDir = movedDirArg || path.join(path.dirname(folder), `${path.basename(folder)}_moved`);
const moveAt = (process.argv.find(a => a.startsWith("--move-at=")) || "--move-at=between").split("=")[1];

const errors: string[] = [];
const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
    errors.push(args.map(a => a instanceof Error ? a.stack || a.message : String(a)).join(" "));
    originalError(...args);
};
process.on("uncaughtException", (error) => { errors.push(`UNCAUGHT: ${error.stack}`); originalError("UNCAUGHT", error); });
process.on("unhandledRejection", (reason) => { errors.push(`UNHANDLED REJECTION: ${reason instanceof Error ? reason.stack : String(reason)}`); originalError("UNHANDLED REJECTION", reason); });

const fakeWindow = { webContents: { send: () => undefined } };

// Mirrors app.ts's openfileRecursive: every non-tmp subfolder, streamed one
// folder at a time.
const scanRecursive = async (dir: string): Promise<void> => {
    const entries = fs.readdirSync(dir, "utf8");
    for (const entry of entries.filter(e => e !== TMP_FOLDER_NAME)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) await scanRecursive(full);
    }
    // onReadyGo first fires with the slice's images, before any video/gif
    // frame extraction starts.
    const onReadyGo = () => { if (moveAt === "scan" && dir === folder) moveVictimsOnce(); };
    await transformDataStreaming(entries, dir, onReadyGo, () => undefined);
};

// Mirrors app.ts's chooseOnnxModelDialog for a .maloi file.
const loadModel = (): void => {
    const maloi = JSON.parse(fs.readFileSync(maloiPath, "utf8"));
    const onnxPath = path.resolve(path.dirname(maloiPath), maloi.onnx || "");
    onnxDetector.setModelPath(onnxPath);
    const names = String(maloi.classes || "").split(",").map((s: string) => s.trim()).filter(Boolean);
    onnxDetector.setClassNames(names);
    onnxDetector.setModelSize(typeof maloi.reshape === "number" ? maloi.reshape : null);
    MediaStore.ensureReady();
    MediaStore.saveDetectionClasses(names);
    MediaStore.getOrCreateModelPath(onnxPath);
};

const pickVictims = (): string[] => {
    const files = fs.readdirSync(folder).map(f => path.join(folder, f)).filter(f => fs.statSync(f).isFile());
    const pick = (re: RegExp) => files.find(f => re.test(f.toLowerCase()));
    return [pick(/\.(jpe?g|png|webp|bmp)$/), pick(/\.gif$/), pick(/\.(mp4|mov|mkv|webm|avi)$/)].filter((f): f is string => Boolean(f));
};

let moved: Array<[string, string]> = [];
const moveVictimsOnce = (): void => {
    if (moved.length > 0) return;
    fs.mkdirSync(movedDir, { recursive: true });
    moved = pickVictims().map(src => [src, path.join(movedDir, path.basename(src))]);
    for (const [src, dest] of moved) fs.renameSync(src, dest);
    console.log(`Moved out (${moveAt}):`, moved.map(([src]) => path.basename(src)));
};

// Moves the files the first time the query a stage reads its work list from
// returns - the list still names them, but they're gone from disk.
const moveAfterFirstCall = (target: any, fnName: string): void => {
    const original = target[fnName];
    target[fnName] = (...args: unknown[]) => {
        const result = original(...args);
        moveVictimsOnce();
        return result;
    };
};

const stage = async (name: string, run: () => Promise<unknown>): Promise<void> => {
    const before = errors.length;
    const started = Date.now();
    console.log(`\n===== STAGE ${name} =====`);
    try {
        await run();
    } catch (error) {
        errors.push(`STAGE ${name} THREW: ${(error as Error).stack}`);
    }
    console.log(`===== STAGE ${name} done in ${Date.now() - started}ms, ${errors.length - before} error(s) =====`);
};

const main = async (): Promise<void> => {
    setActiveFolder(folder);
    redirectToActiveFolder();

    HashStore.closeConnection();
    const dbPath = getDbPath();
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbPath + suffix, { force: true });
    console.log("Deleted database", dbPath);

    // Frames are cached per source path (<md5(path)>_<position>.jpg); drop the
    // ones of the files about to be moved so frame extraction really has to
    // read them, like on a first-ever load.
    const victimHashes = pickVictims().map(hashFor);
    const framesDir = getFramesDir();
    if (fs.existsSync(framesDir)) {
        for (const file of fs.readdirSync(framesDir).filter(f => victimHashes.some(h => f.startsWith(h)))) {
            fs.rmSync(path.join(framesDir, file), { force: true });
        }
    }

    loadModel();

    if (moveAt === "hash") moveAfterFirstCall(MediaStore, "mediaMissingContentMd5");
    if (moveAt === "detect") moveAfterFirstCall(MediaStore, "findAllItemsExists");

    try {
        await stage("scan", () => scanRecursive(folder));
        if (moveAt === "between") moveVictimsOnce();
        if (moveAt === "index") moveAfterFirstCall(MediaStore, "findAllMediaThatExists");

        // Same order as app.ts's runSuperExecutionPipeline. Note the scan's
        // own fire-and-forget backfillContentMd5 is still running alongside.
        await stage("hash", () => backfillContentMd5());
        await stage("index", async () => {
            const medias = MediaStore.findAllMediaThatExists();
            await mediaIndexer.indexMediaBackground(medias.map(m => ({
                item: m.localPath, mime: m.mime, kind: m.kind, contentMd5: m.contentMd5, id: m.id,
            })));
        });
        await stage("detect", () => processMediaToDetections(fakeWindow, onnxDetector, onnxDetector.getClassNames(), false));
        await stage("duplicates", () => duplicateFinder.findIndexDuplicates());
    } finally {
        for (const [src, dest] of moved) if (fs.existsSync(dest)) fs.renameSync(dest, src);
        console.log("Moved back:", moved.map(([src]) => path.basename(src)));
    }

    console.log(`\n===== RESULT: ${errors.length} error(s) =====`);
    errors.forEach((e, i) => console.log(`[${i + 1}] ${e}`));
};

app.whenReady()
    .then(main)
    .catch((error) => { errors.push(`MAIN THREW: ${(error as Error).stack}`); originalError(error); })
    .finally(() => { app.exit(errors.length === 0 ? 0 : 1); });
