// The stage runners of the headless LSR (cli/lsr.ts runs them in order).
// Every native module comes in through `deps` (lsr.ts imports them only
// after the arguments and runtime are validated); this file itself has type
// imports only. Each runner returns its summary note, or throws
// StageFailure for a stage-level failure (exit 3).
import fs from "fs";
import path from "path";
import type { CliOptions, CliStage } from "./args";
import type { SuperContext } from "../pipeline/superPipeline";
import type { ExtraResult } from "./extraDups";
import { allFailedError, everyItemFailed, StageFailure } from "./stageRules";
import { targetsFor } from "./reportArgs";
import { stampFor } from "./runLog";
import { formatBytes, type ReportGroup, type ReportTotals } from "../reporting/report";

export interface StageDeps {
    MediaStore: typeof import("../mediaDb/MediaStore");
    HashStore: typeof import("../compareImg/HashStore");
    superPipeline: typeof import("../pipeline/superPipeline");
    pipelineRun: typeof import("../pipeline/PipelineRun");
    mediaPages: typeof import("../mediaDb/mediaPages");
    scan: typeof import("./scan");
    extraDups: typeof import("./extraDups");
    reportWriter: typeof import("../reporting/report");
    reportGroups: typeof import("../reporting/groups");
}

export interface FailedFiles { count: number; paths: string[] }

export interface StageState {
    // Per stage, for the end summary.
    failedFiles: Partial<Record<CliStage, FailedFiles>>;
    // This run's extraDups results (not persisted), for the report.
    extraResults: ExtraResult[] | null;
    // Files the report stage wrote.
    reportPaths: string[];
}

export const createStageRunners = (
    options: CliOptions,
    ctx: SuperContext,
    shouldStop: () => boolean,
    deps: StageDeps,
    state: StageState,
): Record<CliStage, () => Promise<string>> => {
    const { MediaStore, superPipeline, pipelineRun } = deps;
    const detections = { media: 0, failed: 0, alreadyDone: 0, withoutFrames: 0, failedPaths: [] as string[] };
    ctx.events.detection = (event) => { detections.media++; if (event.error) detections.failed++; };
    ctx.events.detectionStats = (stats) => {
        detections.alreadyDone = stats.alreadyDone;
        detections.withoutFrames = stats.withoutFrames;
        detections.failedPaths = stats.failedPaths;
    };

    const runExtra = async (): Promise<{ results: ExtraResult[]; stopped: boolean }> => {
        const budgetMs = deps.extraDups.extraDupsBudgetMs(process.env);
        let done = 0;
        return deps.extraDups.runExtraDuplicates({
            shouldStop,
            run: (algorithm) => deps.extraDups.runInChild(options.root, algorithm, {
                budgetMs,
                shouldStop,
                onTick: () => pipelineRun.updateStage(done, 3),
            }),
            onStep: (n, total) => { done = n; pipelineRun.updateStage(n, total); },
        });
    };

    return {
        scan: async () => {
            const stats = await deps.scan.scanTree(options.root, { shouldStop, onProgress: (s) => pipelineRun.updateStage(s.media) });
            if (stats.folders === 0 && stats.unreadableFolders > 0) throw new StageFailure(`the media folder itself cannot be read: ${options.root}`);
            return `${stats.folders} folders, ${stats.media} media` +
                (stats.unreadableFolders ? `, ${stats.unreadableFolders} unreadable folders` : "") +
                (stats.skippedSymlinks ? `, ${stats.skippedSymlinks} symlinks skipped` : "") +
                (stats.skippedSpecial ? `, ${stats.skippedSpecial} special files skipped` : "");
        },
        hash: async () => {
            const missingBefore = MediaStore.countMediaMissingContentMd5();
            const hashedBefore = deps.mediaPages.countMedia() - missingBefore;
            let hashStats = { hashed: 0, failed: 0, missing: 0, failedPaths: [] as string[] };
            ctx.events.hashStats = (r) => { hashStats = r; };
            await superPipeline.runHash(ctx);
            state.failedFiles.hash = { count: hashStats.failed, paths: hashStats.failedPaths };
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
            state.failedFiles.index = { count: indexStats.failed, paths: indexStats.failedPaths };
            if (failure !== undefined) throw new StageFailure(failure);
            if (everyItemFailed(indexStats.done, indexStats.failed)) throw allFailedError("index", indexStats.failed);
            return `${count} media checked` + (indexStats.failed ? `, ${indexStats.failed} failed` : "");
        },
        detect: async () => {
            const result = await superPipeline.runDetect(ctx);
            if (result === "no-model" || result === "no-classes") throw new StageFailure(result);
            // Video/GIF media without frames still emit an (empty) result.
            const processedMedia = detections.media - detections.withoutFrames;
            state.failedFiles.detect = { count: detections.failed, paths: detections.failedPaths };
            if (everyItemFailed(processedMedia - detections.failed, detections.failed, detections.alreadyDone)) throw allFailedError("detect", detections.failed);
            return `${processedMedia} media processed, ${detections.failed} failed, ${detections.alreadyDone} already detected` +
                (detections.withoutFrames ? `, ${detections.withoutFrames} videos/GIFs without frames skipped` : "");
        },
        duplicates: async () => {
            const groups = await superPipeline.runDuplicates(ctx);
            if (shouldStop()) return "the previous duplicate result is kept";
            return `${groups.length} duplicate groups`;
        },
        extraDups: async () => {
            const { results, stopped } = await runExtra();
            state.extraResults = stopped ? null : results;
            if (results.length > 0 && results.every(r => r.error)) {
                throw new StageFailure(`every duplicate algorithm failed: ${deps.extraDups.formatExtraSummary(results)}`);
            }
            return deps.extraDups.formatExtraSummary(results);
        },
        report: async () => {
            // The other algorithms are not persisted: use this run's, or run
            // them now (report on its own, or extraDups was stopped).
            let extra = state.extraResults;
            if (!extra) {
                const fresh = await runExtra();
                if (fresh.stopped) return "stopped before the report was written";
                extra = fresh.results;
            }
            const stem = options.reportStem ?? path.join(options.root, "tmp", "reports", `lsr-${stampFor(new Date())}`);
            fs.mkdirSync(path.dirname(stem), { recursive: true });
            const targets = targetsFor(stem, options.reportFormats);

            deps.HashStore.ensureReady();
            const pixel = deps.HashStore.getDuplicateGroups();
            const algorithms: Record<string, string> = { pixel: `${pixel.length} groups as last persisted by the duplicates stage` };
            for (const r of extra) algorithms[r.algorithm] = r.error ? `FAILED: ${r.error}` : `${r.groups.length} groups`;
            const groupsOf = deps.reportGroups.reportGroupsFor;
            async function* allGroups(): AsyncGenerator<ReportGroup> {
                yield* groupsOf("pixel", pixel);
                for (const r of extra ?? []) if (!r.error) yield* groupsOf(r.algorithm, r.groups);
            }
            const totals: ReportTotals = await deps.reportWriter.writeReport(
                { generatedAt: new Date().toISOString(), root: options.root, maloi: options.maloi, stages: options.stages, algorithms },
                allGroups(),
                targets,
            );
            state.reportPaths = Object.values(targets).filter((p): p is string => Boolean(p));
            const perAlgorithm = Object.keys(totals.groupsByAlgorithm)
                .map(a => `${a} ${totals.groupsByAlgorithm[a]} (${formatBytes(totals.reclaimableBytesByAlgorithm[a] ?? 0)} reclaimable)`);
            return `${perAlgorithm.length ? perAlgorithm.join(", ") : "no duplicate groups"}; written to ${state.reportPaths.join(", ")}`;
        },
    };
};
