// Headless "Load super recursive" for big libraries on a server:
//   ELECTRON_RUN_AS_NODE=1 electron electron-dist/cli/lsr.js --root <dir> --maloi <file> [--stages ...]
// Runs scan -> hash -> index -> detect -> duplicates -> extraDups -> report
// against <root>, writing the same per-folder index.db the GUI reads, a
// decision report and a run log under <root>/tmp/. Never moves or deletes media. See cli/args.ts's USAGE.
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
import * as inFlight from "../system/inFlight";
import { CLI_ONLY_STAGES, MAX_DUPLICATE_BUCKET, StageFailure } from "./stageRules";
import type { FailedFiles, StageState } from "./stages";

// Re-exported for existing importers (tests).
export { ALL_FAILED_MIN_ITEMS, everyItemFailed, MAX_DUPLICATE_BUCKET } from "./stageRules";

export const EXIT_OK = 0;
export const EXIT_ITEM_ERRORS = 1;
export const EXIT_USAGE = 2;
export const EXIT_STAGE_FAILED = 3;

const RUN_HINT = "Run it with Electron's bundled Node: ELECTRON_RUN_AS_NODE=1 electron electron-dist/cli/lsr.js ...";

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

interface StageSummary { stage: CliStage; elapsedMs: number; note: string; failed?: FailedFiles }

// Failed files listed per stage in the end summary (all are in the log).
const SUMMARY_FAILED_FILES = 20;

const run = async (options: CliOptions, log: RunLog, shouldStop: () => boolean, errorCount: () => number, state: StageState): Promise<{ code: number; summaries: StageSummary[] }> => {
    const MediaStore = await import("../mediaDb/MediaStore");
    const onnxDetector = await import("../objectDetection/onnxDetector");
    const superPipeline = await import("../pipeline/superPipeline");
    const pipelineRun = await import("../pipeline/PipelineRun");
    const { readMaloi, applyMaloi } = await import("../objectDetection/maloi");
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

    const ctx: import("../pipeline/superPipeline").SuperContext = {
        detector,
        shouldStop,
        abort: shouldStop,
        maxDuplicateBucket: MAX_DUPLICATE_BUCKET,
        strict: true,
        events: { progress: (processed, total) => pipelineRun.updateStage(processed, total) },
    };
    const { createStageRunners } = await import("./stages");
    const stageRunners = createStageRunners(options, ctx, shouldStop, {
        MediaStore,
        HashStore: await import("../compareImg/HashStore"),
        superPipeline,
        pipelineRun,
        mediaPages: await import("../mediaDb/mediaPages"),
        scan: await import("./scan"),
        extraDups: await import("./extraDups"),
        reportWriter: await import("../reporting/report"),
        reportGroups: await import("../reporting/groups"),
        duplicateMath: await import("../compareImg/duplicateMath"),
    }, state);

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
            summaries.push({ stage, elapsedMs: Date.now() - started, note: errors ? `${note}; ${errors} errors logged` : note, failed: state.failedFiles[stage] });
            log.info(`stage ${stage} done in ${formatDuration(Date.now() - started)}: ${summaries[summaries.length - 1].note}`);
        } catch (error) {
            log.error(`stage ${stage} failed: ${(error as Error).stack || (error as Error).message}`);
            summaries.push({ stage, elapsedMs: Date.now() - started, note: `FAILED: ${(error as Error).message}`, failed: state.failedFiles[stage] });
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
    const state: StageState = { failedFiles: {}, extraResults: null, reportPaths: [] };
    try {
        ({ code, summaries } = await run(options, log, stop.shouldStop, () => counters.errors, state));
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
    for (const p of state.reportPaths) log.info(`  report: ${p}`);
    log.info(`  exit code ${code}; log: ${log.path}`);

    clearInterval(watchdog);
    stop.dispose();
    lock.release();
    await finish(log, code);
};

if (require.main === module) {
    main(process.argv.slice(2));
}
