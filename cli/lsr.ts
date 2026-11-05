// Headless "Load super recursive" for big libraries on a server:
//   ELECTRON_RUN_AS_NODE=1 electron electron-dist/cli/lsr.js --root <dir> --maloi <file> [--stages ...]
// Runs scan -> hash -> index -> detect -> duplicates against <root>, writing
// the same per-folder index.db the GUI reads, plus a run log under
// <root>/tmp/logs/. Never moves or deletes media. See cli/args.ts's USAGE.
//
// Only the pure CLI modules are imported up front: everything that loads a
// native addon (better-sqlite3 is built for Electron's ABI) is imported after
// the arguments are validated, so --help and usage errors work anywhere.
import { parseArgs, USAGE, type CliOptions, type CliStage } from "./args";
import { createRunLog, patchConsole, type RunLog } from "./runLog";
import { createReporter, formatDuration } from "./progress";
import { installStopHandlers, EXIT_INTERRUPTED } from "./signals";
import { acquireLock } from "./lock";
import { setActiveFolder } from "../DirectorioCache";
import type { StageDef } from "../pipeline/PipelineRun";
import type { ExtraResult } from "./extraDups";
import * as inFlight from "../system/inFlight";

export const EXIT_OK = 0;
export const EXIT_ITEM_ERRORS = 1;
export const EXIT_USAGE = 2;
export const EXIT_STAGE_FAILED = 3;

// Pixel-duplicate buckets above this many frames get exact matches only (see
// duplicateFinder.findIndexDuplicatesBucketed): one degenerate bucket - all
// black frames, say - would otherwise cost k^2 pixel comparisons.
export const MAX_DUPLICATE_BUCKET = 5000;

const RUN_HINT = "Run it with Electron's bundled Node: ELECTRON_RUN_AS_NODE=1 electron electron-dist/cli/lsr.js ...";

class StageFailure extends Error { }

// Stages the GUI chain does not have.
const CLI_ONLY_STAGES: StageDef[] = [
    { key: "extraDups", label: "Running the other duplicate algorithms" },
];

// The last extraDups results of this run (they are not persisted).
let extraResults: ExtraResult[] | null = null;

// The files workers were busy with when an error escaped every handler -
// most likely the one that caused it (see system/inFlight.ts).
const inFlightNote = (): string => {
    const files = inFlight.snapshot();
    if (files.length === 0) return "";
    const shown = files.slice(0, 20);
    return `\n  files in progress: ${shown.join(", ")}${files.length > shown.length ? ` (+${files.length - shown.length} more)` : ""}`;
};

// Progress watchdog: a run whose progress has not moved for this long is
// considered hung and exits 3. Override with LSR_STALL_MINUTES.
export const DEFAULT_STALL_MINUTES = 30;
export const stallTimeoutMs = (env: NodeJS.ProcessEnv): number => {
    const minutes = Number(env.LSR_STALL_MINUTES);
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_STALL_MINUTES) * 60_000;
};

// A stage that tried at least this many items and got not one of them
// through is FAILED (exit 3, later stages skipped): that is almost always
// system-wide (ffmpeg missing, disk full, read-only database). Fewer
// failures - one corrupt new file on a re-run, say - stay item errors
// (exit 1), so a single bad file can never block every future run.
export const ALL_FAILED_MIN_ITEMS = 5;

// alreadyDone: items of this stage finished by EARLIER runs. A re-run only
// retries the leftovers - mostly the permanently bad files - so "none of
// this run's items succeeded" alone would turn a handful of bad files into
// a FAILED stage on every re-run; with earlier successes it is not system-wide.
export const everyItemFailed = (succeeded: number, failed: number, alreadyDone = 0): boolean =>
    failed >= ALL_FAILED_MIN_ITEMS && succeeded === 0 && alreadyDone === 0;

const allFailedError = (stage: string, failed: number): StageFailure =>
    new StageFailure(`every one of the ${failed} items the ${stage} stage tried failed - most likely a system-wide problem (ffmpeg missing, disk full, read-only database); see the log`);

// Called on every progress snapshot (see run); set up in main.
let onActivity: () => void = () => undefined;

// better-sqlite3 is compiled for Electron's ABI (package.json postinstall);
// under a plain node it fails to load with NODE_MODULE_VERSION mismatch.
const checkNativeRuntime = (): string | null => {
    try {
        // The JS wrapper loads anywhere; the native binding only on first open.
        const Database = require("better-sqlite3");
        new Database(":memory:").close();
        return null;
    } catch (error) {
        const message = (error as Error).message;
        const where = process.versions.electron ? `Electron ${process.versions.electron}` : `plain Node ${process.version}`;
        return `cannot load better-sqlite3 under ${where}: ${message.split("\n")[0]}\n${RUN_HINT}`;
    }
};

interface FailedFiles { count: number; paths: string[] }
interface StageSummary { stage: CliStage; elapsedMs: number; note: string; failed?: FailedFiles }

// Failed files listed per stage in the end summary (all are in the log).
const SUMMARY_FAILED_FILES = 20;

const run = async (options: CliOptions, log: RunLog, shouldStop: () => boolean, errorCount: () => number): Promise<{ code: number; summaries: StageSummary[] }> => {
    const MediaStore = await import("../mediaDb/MediaStore");
    const onnxDetector = await import("../objectDetection/onnxDetector");
    const superPipeline = await import("../pipeline/superPipeline");
    const pipelineRun = await import("../pipeline/PipelineRun");
    const { readMaloi, applyMaloi } = await import("../objectDetection/maloi");
    const { scanTree } = await import("./scan");
    const { countMedia } = await import("../mediaDb/mediaPages");
    const failedFiles: Partial<Record<CliStage, FailedFiles>> = {};
    const { runExtraDuplicates, runInChild, extraDupsBudgetMs, formatExtraSummary } = await import("./extraDups");

    MediaStore.ensureReady();
    if (options.maloi) {
        try {
            applyMaloi(readMaloi(options.maloi), onnxDetector, MediaStore);
            log.info(`model ${onnxDetector.getModelPath()} with ${onnxDetector.getClassNames().length} classes`);
        } catch (error) {
            log.error((error as Error).message);
            return { code: EXIT_USAGE, summaries: [] };
        }
    }
    const { isFakeDetectorRequested, createFakeDetector } = await import("./fakeDetector");
    const detector: import("../pipeline/superPipeline").DetectorLike = isFakeDetectorRequested() ? createFakeDetector() : onnxDetector;
    if (detector !== onnxDetector) log.warn("NODE_ENV=test + LSR_FAKE_DETECTOR=1: using the fake test detector, not the ONNX model");
    if (options.stages.includes("detect")) {
        if (!detector.isAvailable()) { log.error(`ONNX model not found: ${detector.getModelPath()}`); return { code: EXIT_USAGE, summaries: [] }; }
        if (detector.getClassNames().length === 0) { log.error("the .maloi file lists no classes"); return { code: EXIT_USAGE, summaries: [] }; }
    }

    const reporter = createReporter((line) => log.info(line));
    pipelineRun.configure({ onProgress: (snapshot) => { onActivity(); reporter.onProgress(snapshot); }, onDone: () => undefined });
    const stageDefs: StageDef[] = [...superPipeline.SUPER_STAGES, ...CLI_ONLY_STAGES];
    pipelineRun.begin("LSR CLI", stageDefs.filter(s => (options.stages as readonly string[]).includes(s.key)));

    const detections = { media: 0, failed: 0, alreadyDone: 0, withoutFrames: 0, failedPaths: [] as string[] };
    const ctx: import("../pipeline/superPipeline").SuperContext = {
        detector,
        shouldStop,
        abort: shouldStop,
        maxDuplicateBucket: MAX_DUPLICATE_BUCKET,
        strict: true,
        events: {
            progress: (processed, total) => pipelineRun.updateStage(processed, total),
            detection: (event) => { detections.media++; if (event.error) detections.failed++; },
            detectionStats: (stats) => { detections.alreadyDone = stats.alreadyDone; detections.withoutFrames = stats.withoutFrames; detections.failedPaths = stats.failedPaths; },
        },
    };

    const stageRunners: Record<CliStage, () => Promise<string>> = {
        scan: async () => {
            const stats = await scanTree(options.root, { shouldStop, onProgress: (s) => pipelineRun.updateStage(s.media) });
            if (stats.folders === 0 && stats.unreadableFolders > 0) throw new StageFailure(`the media folder itself cannot be read: ${options.root}`);
            return `${stats.folders} folders, ${stats.media} media` +
                (stats.unreadableFolders ? `, ${stats.unreadableFolders} unreadable folders` : "") +
                (stats.skippedSymlinks ? `, ${stats.skippedSymlinks} symlinks skipped` : "") +
                (stats.skippedSpecial ? `, ${stats.skippedSpecial} special files skipped` : "");
        },
        hash: async () => {
            const missingBefore = MediaStore.countMediaMissingContentMd5();
            const hashedBefore = countMedia() - missingBefore;
            let hashStats = { hashed: 0, failed: 0, missing: 0, failedPaths: [] as string[] };
            ctx.events.hashStats = (r) => { hashStats = r; };
            await superPipeline.runHash(ctx);
            failedFiles.hash = { count: hashStats.failed, paths: hashStats.failedPaths };
            if (everyItemFailed(hashStats.hashed, hashStats.failed, hashedBefore)) throw allFailedError("hash", hashStats.failed);
            return `${missingBefore - MediaStore.countMediaMissingContentMd5()} of ${missingBefore} unhashed files hashed` +
                (hashStats.failed ? `, ${hashStats.failed} unreadable` : "") + (hashStats.missing ? `, ${hashStats.missing} no longer on disk` : "");
        },
        index: async () => {
            let failure: string | undefined;
            ctx.events.indexDone = (result) => { if (!result.success) failure = result.error; };
            // "done" already includes media indexed by earlier runs.
            let indexStats = { done: 0, failed: 0, failedPaths: [] as string[] };
            ctx.events.indexStats = (s) => { indexStats = s; };
            const count = await superPipeline.runBuildIndex(ctx);
            failedFiles.index = { count: indexStats.failed, paths: indexStats.failedPaths };
            if (failure !== undefined) throw new StageFailure(failure);
            if (everyItemFailed(indexStats.done, indexStats.failed)) throw allFailedError("index", indexStats.failed);
            return `${count} media checked` + (indexStats.failed ? `, ${indexStats.failed} failed` : "");
        },
        detect: async () => {
            const result = await superPipeline.runDetect(ctx);
            if (result === "no-model" || result === "no-classes") throw new StageFailure(result);
            // Video/GIF media without frames still emit an (empty) result.
            const processedMedia = detections.media - detections.withoutFrames;
            failedFiles.detect = { count: detections.failed, paths: detections.failedPaths };
            if (everyItemFailed(processedMedia - detections.failed, detections.failed, detections.alreadyDone)) throw allFailedError("detect", detections.failed);
            return `${processedMedia} media processed, ${detections.failed} failed, ${detections.alreadyDone} already detected` +
                (detections.withoutFrames ? `, ${detections.withoutFrames} videos/GIFs without frames skipped` : "");
        },
        extraDups: async () => {
            const budgetMs = extraDupsBudgetMs(process.env);
            let done = 0;
            const { results, stopped } = await runExtraDuplicates({
                shouldStop,
                run: (algorithm) => runInChild(options.root, algorithm, {
                    budgetMs,
                    shouldStop,
                    onTick: () => pipelineRun.updateStage(done, 3),
                }),
                onStep: (n, total) => { done = n; pipelineRun.updateStage(n, total); },
            });
            extraResults = stopped ? null : results;
            const failed = results.filter(r => r.error);
            if (results.length > 0 && failed.length === results.length) throw new StageFailure(`every duplicate algorithm failed: ${formatExtraSummary(results)}`);
            return formatExtraSummary(results);
        },
        duplicates: async () => {
            const groups = await superPipeline.runDuplicates(ctx);
            if (shouldStop()) return "the previous duplicate result is kept";
            return `${groups.length} duplicate groups`;
        },
    };

    const summaries: StageSummary[] = [];
    let code = EXIT_OK;
    for (const stage of options.stages) {
        if (shouldStop()) break;
        pipelineRun.startStage(stage);
        const started = Date.now();
        const errorsBefore = errorCount();
        try {
            const note = (await stageRunners[stage]()) + (shouldStop() ? " (stopped early)" : "");
            reporter.flush();
            const errors = errorCount() - errorsBefore;
            summaries.push({ stage, elapsedMs: Date.now() - started, note: errors ? `${note}; ${errors} errors logged` : note, failed: failedFiles[stage] });
            log.info(`stage ${stage} done in ${formatDuration(Date.now() - started)}: ${summaries[summaries.length - 1].note}`);
        } catch (error) {
            log.error(`stage ${stage} failed: ${(error as Error).stack || (error as Error).message}`);
            summaries.push({ stage, elapsedMs: Date.now() - started, note: `FAILED: ${(error as Error).message}`, failed: failedFiles[stage] });
            code = EXIT_STAGE_FAILED;
            break;
        }
    }
    if (code === EXIT_STAGE_FAILED) pipelineRun.fail("stage failed");
    else pipelineRun.finish();
    return { code, summaries };
};

const finish = async (log: RunLog, code: number, beforeExit?: () => void): Promise<never> => {
    try {
        const HashStore = await import("../compareImg/HashStore");
        HashStore.closeConnection();
    } catch { /* never opened */ }
    await log.close();
    // better-sqlite3 handles or ffmpeg children could keep the loop alive.
    beforeExit?.();
    process.exit(code);
};

export const main = async (argv: string[]): Promise<void> => {
    const parsed = parseArgs(argv);
    if (!parsed.ok) {
        process.stderr.write(`error: ${parsed.error}\n\n${USAGE}`);
        process.exit(EXIT_USAGE);
    }
    if (parsed.help) {
        process.stdout.write(USAGE);
        process.exit(EXIT_OK);
    }
    const options = parsed.options;

    const runtimeError = checkNativeRuntime();
    if (runtimeError) {
        process.stderr.write(`error: ${runtimeError}\n`);
        process.exit(EXIT_USAGE);
    }

    const lock = acquireLock(options.root);
    if (!lock.ok) {
        process.stderr.write(`error: ${lock.error}\n`);
        process.exit(EXIT_USAGE);
    }

    // Before anything opens index.db: every tmp/ path derives from it.
    setActiveFolder(options.root);
    const log = createRunLog(options.root, { verbose: options.verbose });
    const { counters } = patchConsole(log);
    const stop = installStopHandlers(
        (signal) => log.warn(`${signal} received: stopping after the current items (signal again to quit immediately; re-run to continue)`),
        process,
        (signal) => {
            log.writeSync(`second ${signal}: exiting immediately (exit code ${EXIT_INTERRUPTED}); re-run the same command to continue`);
            lock.release();
        },
    );
    // An uncaught exception can leave a stage promise pending forever: log
    // it and exit 3 (everything already written is resumable). The lock is
    // released only right before the exit, while nothing writes any more.
    let fatalExiting = false;
    const fatal = (what: string, reason: unknown): void => {
        log.writeSync(`${what}: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}${inFlightNote()} - exiting (exit code ${EXIT_STAGE_FAILED})`);
        if (fatalExiting) return;
        fatalExiting = true;
        setTimeout(() => { lock.release(); process.exit(EXIT_STAGE_FAILED); }, 5000).unref();
        finish(log, EXIT_STAGE_FAILED, () => lock.release()).catch(() => { lock.release(); process.exit(EXIT_STAGE_FAILED); });
    };
    process.on("uncaughtException", (error) => fatal("uncaught exception", error));
    // A stray rejection (one file's callback failing outside its awaited
    // promise) is an item error, not a reason to stop: dying on it would
    // turn one poison file into a crash on every re-run. A run that really
    // hangs is caught by the stall watchdog below.
    process.on("unhandledRejection", (reason) => console.error(`unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}${inFlightNote()}`));
    const stallMs = stallTimeoutMs(process.env);
    let lastActivity = Date.now();
    onActivity = () => { lastActivity = Date.now(); };
    // Deliberately NOT unref'd: it also keeps the event loop alive while a
    // stage awaits a promise that will never settle, so such a hang ends in
    // the watchdog's exit 3 instead of a silent exit 0 with the lock left.
    const watchdog = setInterval(() => {
        if (Date.now() - lastActivity > stallMs) fatal("stalled", new Error(`no progress for ${formatDuration(Date.now() - lastActivity)} (LSR_STALL_MINUTES=${stallMs / 60000})`));
    }, Math.min(60_000, stallMs));
    // Belt and braces: the loop draining before main() reaches its own exit
    // means some stage promise can never settle.
    process.on("beforeExit", () => fatal("hung", new Error("the event loop drained while a stage was still pending")));

    const startedAt = Date.now();
    log.info(`LSR run on ${options.root} - stages: ${options.stages.join(", ")} - log: ${log.path}`);

    let code = EXIT_OK;
    let summaries: StageSummary[] = [];
    try {
        ({ code, summaries } = await run(options, log, stop.shouldStop, () => counters.errors));
    } catch (error) {
        log.error(`fatal: ${(error as Error).stack || (error as Error).message}`);
        code = EXIT_STAGE_FAILED;
    }
    if (code === EXIT_OK && stop.shouldStop()) code = EXIT_INTERRUPTED;
    if (code === EXIT_OK && counters.errors > 0) code = EXIT_ITEM_ERRORS;

    log.info("==== LSR summary ====");
    for (const s of summaries) {
        log.info(`  ${s.stage.padEnd(10)} ${formatDuration(s.elapsedMs).padStart(7)}  ${s.note}`);
        if (s.failed && s.failed.count > 0) {
            const shown = s.failed.paths.slice(0, SUMMARY_FAILED_FILES);
            log.info(`             failed files (${s.failed.count}):`);
            for (const p of shown) log.info(`               ${p}`);
            if (s.failed.count > shown.length) log.info(`               ... and ${s.failed.count - shown.length} more (see the log)`);
        }
    }
    log.info(`  total      ${formatDuration(Date.now() - startedAt).padStart(7)}  ${counters.errors} errors, ${counters.warnings} warnings logged`);
    if (code === EXIT_INTERRUPTED) log.info("  interrupted - re-run the same command to continue");
    log.info(`  exit code ${code}; log: ${log.path}`);

    clearInterval(watchdog);
    stop.dispose();
    lock.release();
    await finish(log, code);
};

if (require.main === module) {
    main(process.argv.slice(2));
}
