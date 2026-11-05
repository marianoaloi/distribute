// The single definition of the "Load super recursive" (LSR) processing chain
// after the folder scan: hash -> index -> detect -> duplicates. Shared by
// app.ts (GUI, which forwards every event to the renderer over IPC) and
// cli/lsr.ts (headless). Electron-free: everything a caller wants to observe
// goes through the SuperEvents sink.
//
// The "scan" stage itself is NOT here - the GUI's scan streams media to the
// renderer as it walks (app.ts's openfileRecursive), the CLI has its own
// sequential walker (cli/scan.ts).
import fs from "fs";
import * as MediaStore from "../mediaDb/MediaStore";
import * as mediaIndexer from "../compareImg/mediaIndexer";
import * as duplicateFinder from "../compareImg/duplicateFinder";
import { backfillContentMd5, type BackfillResult } from "../mediaDb/backfill";
import type { IndexStats } from "../compareImg/mediaIndexer";
import { countMedia, listMediaPage } from "../mediaDb/mediaPages";
import { forEachPage } from "../mediaDb/paging";
import { processMediaToDetections, type DetectionFoundEvent, type DetectionPassStats, type DetectorLike as LoopDetector } from "../objectDetection/processImages";
import type { StageDef } from "./PipelineRun";

export type StageKey = "scan" | "hash" | "index" | "detect" | "duplicates";

// pipelineRun's stage list for the LSR chain - order matches runSuperChain.
// "scan" itself has no tracked progress (the folder walk's file count isn't
// known upfront) - it exists here only so the overall-ETA fraction
// (stageIndex/stageCount) accounts for it once "hash" starts.
export const SUPER_STAGES: (StageDef & { key: StageKey })[] = [
    { key: "scan", label: "Scanning folder" },
    { key: "hash", label: "Hashing file content" },
    { key: "index", label: "Building comparison index" },
    { key: "detect", label: "Detecting objects" },
    { key: "duplicates", label: "Finding visual duplicates" },
];

export interface DetectorLike extends LoopDetector {
    isAvailable(): boolean;
    getClassNames(): string[];
}

// Every hook is optional; the GUI maps each to its legacy IPC channel.
export interface SuperEvents {
    stageStarted?(key: StageKey): void;
    // Progress of the current stage (pipelineRun's stage bar).
    progress?(processed: number, total: number): void;
    indexProgress?(processed: number, total: number): void; // "indexRebuildProgress"
    indexDone?(result: { success: boolean; count?: number; error?: string }): void; // "indexRebuilt"
    detection?(event: DetectionFoundEvent): void; // "detectionFound"
    detectionProgress?(p: { processed: number; total: number }): void; // "detectionProgress"
    detectionsComplete?(result: DetectResult): void; // "detectionsComplete"
    detectionStats?(stats: DetectionPassStats): void;
    hashStats?(result: BackfillResult): void;
    indexStats?(stats: IndexStats): void;
    duplicates?(groups: string[][]): void; // "duplicatesFound"
}

export interface SuperContext {
    events: SuperEvents;
    // Polled by the detection loop before each media (the GUI's "stop
    // detection" button).
    shouldStop(): boolean;
    // Polled between pages/batches of the hash, index and duplicates stages
    // and between chain stages: true ends the run early, leaving everything
    // finished so far persisted (the headless runner's SIGINT). The GUI
    // leaves it unset - its stop button only ever meant detection.
    abort?(): boolean;
    // Pixel-duplicate buckets larger than this skip the O(k^2) near-match
    // comparison (exact hash matches only). Unset = no cap (GUI default).
    maxDuplicateBucket?: number;
    // true: a stage that fails as a whole (DB error, crash in the loop)
    // throws instead of being reported as an empty/finished result - the
    // headless runner turns that into exit code 3. The GUI leaves it unset
    // and keeps showing an empty result.
    strict?: boolean;
    detector: DetectorLike;
}

const failStage = (ctx: SuperContext, stage: StageKey, error: unknown): void => {
    if (ctx.strict) throw error instanceof Error ? error : new Error(`${stage} stage failed: ${String(error)}`);
};

export type DetectResult = "done" | "stopped" | "no-model" | "no-classes";

export const runHash = async (ctx: SuperContext): Promise<void> => {
    const result = await backfillContentMd5((processed, total) => ctx.events.progress?.(processed, total), ctx.abort);
    ctx.events.hashStats?.(result);
    if (!result.ok) failStage(ctx, "hash", "content hashing aborted (see the log)");
};

// Media per indexMediaBackground call - one page of rows in memory at a time.
export const INDEX_PAGE_SIZE = 500;

// (Re)indexes every media still on disk into the compareImg index, one
// keyset page of the media table at a time (never the whole table in
// memory). Already-indexed items are skipped inside mediaIndexer, so a
// re-run only pays a lookup per item. Returns how many media were submitted
// (on disk); never throws (reports through indexDone).
export const runBuildIndex = async (ctx: SuperContext): Promise<number> => {
    const { events } = ctx;
    try {
        MediaStore.ensureReady();
        // Upper bound: rows whose file vanished are dropped page by page.
        const total = countMedia();
        let done = 0;
        let submitted = 0;
        const stats: IndexStats = { done: 0, skipped: 0, failed: 0, failedPaths: [] };
        events.indexProgress?.(0, total);
        events.progress?.(0, total);
        await forEachPage(
            (after, limit) => {
                const rows = listMediaPage(after, limit);
                return { rows, next: rows.length ? rows[rows.length - 1].rowid : after };
            },
            async (rows) => {
                const existing = rows.filter(m => fs.existsSync(m.localPath));
                submitted += existing.length;
                done += rows.length - existing.length;
                stats.skipped += rows.length - existing.length;
                const base = done;
                const page = await mediaIndexer.indexMediaBackground(existing.map(m => ({
                    item: m.localPath,
                    mime: m.mime,
                    kind: m.kind,
                    contentMd5: m.contentMd5,
                    id: m.id,
                })), (processed) => {
                    events.indexProgress?.(base + processed, total);
                    events.progress?.(base + processed, total);
                });
                done += existing.length;
                stats.done += page.done;
                stats.skipped += page.skipped;
                stats.failed += page.failed;
                stats.failedPaths.push(...page.failedPaths.slice(0, Math.max(0, 100 - stats.failedPaths.length)));
            },
            { pageSize: INDEX_PAGE_SIZE, shouldStop: ctx.abort },
        );
        events.indexStats?.(stats);
        events.indexDone?.({ success: true, count: submitted });
        return submitted;
    } catch (error) {
        console.error("rebuildIndex failed", error);
        events.indexDone?.({ success: false, error: (error as Error).message });
        failStage(ctx, "index", error);
        return 0;
    }
};

// Gate: refuses to start (rather than silently no-op or error mid-run)
// unless both a model and at least one class name are configured.
export const runDetect = async (ctx: SuperContext): Promise<DetectResult> => {
    const result = await detectGated(ctx);
    ctx.events.detectionsComplete?.(result);
    return result;
};

const detectGated = async (ctx: SuperContext): Promise<DetectResult> => {
    const { detector, events } = ctx;
    if (!detector.isAvailable()) return "no-model";
    const classNames = detector.getClassNames();
    if (classNames.length === 0) return "no-classes";

    const sink = {
        found: (event: DetectionFoundEvent) => events.detection?.(event),
        progress: (p: { processed: number; total: number }) => events.detectionProgress?.(p),
    };
    try {
        const stats = await processMediaToDetections(sink, detector, classNames, ctx.shouldStop,
            (processed, total) => events.progress?.(processed, total));
        events.detectionStats?.(stats);
    } catch (error) {
        console.error("processMediaToDetections failed", error);
        failStage(ctx, "detect", error);
    }
    return ctx.shouldStop() ? "stopped" : "done";
};

// Pixel duplicate scan (persisted to items_duplicated). Never throws: a
// failure reports (and returns) an empty group list.
export const runDuplicates = async (ctx: SuperContext): Promise<string[][]> => {
    try {
        const result = await duplicateFinder.findIndexDuplicatesBucketed({
            onProgress: (processed, total) => ctx.events.progress?.(processed, total),
            maxBucket: ctx.maxDuplicateBucket,
            shouldStop: ctx.abort,
        });
        // Stopped part-way: the previous persisted result is left in place
        // and nothing is announced.
        if (result.stopped) return [];
        ctx.events.duplicates?.(result.groups);
        return result.groups;
    } catch (error) {
        console.error("findIndexDuplicates failed", error);
        ctx.events.duplicates?.([]);
        failStage(ctx, "duplicates", error);
        return [];
    }
};

// Runs the selected post-scan stages in canonical order. Stage functions
// report their own item-level failures; an unexpected throw propagates.
export const runSuperChain = async (ctx: SuperContext, stages: readonly StageKey[]): Promise<void> => {
    const steps: [StageKey, () => Promise<unknown>][] = [
        ["hash", () => runHash(ctx)],
        ["index", () => runBuildIndex(ctx)],
        ["detect", () => runDetect(ctx)],
        ["duplicates", () => runDuplicates(ctx)],
    ];
    for (const [key, run] of steps) {
        if (!stages.includes(key)) continue;
        if (ctx.abort?.()) return;
        ctx.events.stageStarted?.(key);
        await run();
    }
};
