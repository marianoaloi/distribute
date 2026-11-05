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

export const EXIT_OK = 0;
export const EXIT_ITEM_ERRORS = 1;
export const EXIT_USAGE = 2;
export const EXIT_STAGE_FAILED = 3;

const RUN_HINT = "Run it with Electron's bundled Node: ELECTRON_RUN_AS_NODE=1 electron electron-dist/cli/lsr.js ...";

class StageFailure extends Error { }

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

interface StageSummary { stage: CliStage; elapsedMs: number; note: string }

const run = async (options: CliOptions, log: RunLog, shouldStop: () => boolean, errorCount: () => number): Promise<{ code: number; summaries: StageSummary[] }> => {
    const MediaStore = await import("../mediaDb/MediaStore");
    const onnxDetector = await import("../objectDetection/onnxDetector");
    const superPipeline = await import("../pipeline/superPipeline");
    const pipelineRun = await import("../pipeline/PipelineRun");
    const { readMaloi, applyMaloi } = await import("../objectDetection/maloi");
    const { scanTree } = await import("./scan");

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
    pipelineRun.configure({ onProgress: reporter.onProgress, onDone: () => undefined });
    pipelineRun.begin("LSR CLI", superPipeline.SUPER_STAGES.filter(s => options.stages.includes(s.key)));

    const detections = { media: 0, failed: 0 };
    const ctx: import("../pipeline/superPipeline").SuperContext = {
        detector,
        shouldStop,
        events: {
            progress: (processed, total) => pipelineRun.updateStage(processed, total),
            detection: (event) => { detections.media++; if (event.error) detections.failed++; },
        },
    };

    const stageRunners: Record<CliStage, () => Promise<string>> = {
        scan: async () => {
            const stats = await scanTree(options.root, { shouldStop, onProgress: (s) => pipelineRun.updateStage(s.media) });
            return `${stats.folders} folders, ${stats.media} media` +
                (stats.unreadableFolders ? `, ${stats.unreadableFolders} unreadable folders` : "") +
                (stats.skippedSymlinkDirs ? `, ${stats.skippedSymlinkDirs} symlinked folders skipped` : "");
        },
        hash: async () => {
            const missingBefore = MediaStore.countMediaMissingContentMd5();
            await superPipeline.runHash(ctx);
            return `${missingBefore - MediaStore.countMediaMissingContentMd5()} of ${missingBefore} unhashed files hashed`;
        },
        index: async () => {
            let failure: string | undefined;
            ctx.events.indexDone = (result) => { if (!result.success) failure = result.error; };
            const count = await superPipeline.runBuildIndex(ctx);
            if (failure !== undefined) throw new StageFailure(failure);
            return `${count} media checked`;
        },
        detect: async () => {
            const result = await superPipeline.runDetect(ctx);
            if (result === "no-model" || result === "no-classes") throw new StageFailure(result);
            return `${detections.media} media processed, ${detections.failed} failed${result === "stopped" ? " (stopped)" : ""}`;
        },
        duplicates: async () => {
            const groups = await superPipeline.runDuplicates(ctx);
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
            const note = await stageRunners[stage]();
            reporter.flush();
            const errors = errorCount() - errorsBefore;
            summaries.push({ stage, elapsedMs: Date.now() - started, note: errors ? `${note}; ${errors} errors logged` : note });
            log.info(`stage ${stage} done in ${formatDuration(Date.now() - started)}: ${summaries[summaries.length - 1].note}`);
        } catch (error) {
            log.error(`stage ${stage} failed: ${(error as Error).stack || (error as Error).message}`);
            summaries.push({ stage, elapsedMs: Date.now() - started, note: `FAILED: ${(error as Error).message}` });
            code = EXIT_STAGE_FAILED;
            break;
        }
    }
    if (code === EXIT_STAGE_FAILED) pipelineRun.fail("stage failed");
    else pipelineRun.finish();
    return { code, summaries };
};

const finish = async (log: RunLog, code: number): Promise<never> => {
    try {
        const HashStore = await import("../compareImg/HashStore");
        HashStore.closeConnection();
    } catch { /* never opened */ }
    await log.close();
    // better-sqlite3 handles or ffmpeg children could keep the loop alive.
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
    const stop = installStopHandlers((signal) =>
        log.warn(`${signal} received: stopping after the current items (signal again to quit immediately; re-run to continue)`));
    let unexpected = 0;
    process.on("uncaughtException", (error) => { unexpected++; log.error(`uncaught exception: ${error.stack || error.message}`); });
    process.on("unhandledRejection", (reason) => { unexpected++; log.error(`unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}`); });

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
    if (code === EXIT_OK && (counters.errors > 0 || unexpected > 0)) code = EXIT_ITEM_ERRORS;

    log.info("==== LSR summary ====");
    for (const s of summaries) log.info(`  ${s.stage.padEnd(10)} ${formatDuration(s.elapsedMs).padStart(7)}  ${s.note}`);
    log.info(`  total      ${formatDuration(Date.now() - startedAt).padStart(7)}  ${counters.errors} errors, ${counters.warnings} warnings logged`);
    if (code === EXIT_INTERRUPTED) log.info("  interrupted - re-run the same command to continue");
    log.info(`  exit code ${code}; log: ${log.path}`);

    stop.dispose();
    lock.release();
    await finish(log, code);
};

if (require.main === module) {
    main(process.argv.slice(2));
}
