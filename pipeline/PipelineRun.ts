// Single authoritative "a long multi-stage job is running" tracker for the
// main process. Exists so a long chain like loadSuperRecursive's (scan ->
// hash -> index -> detect -> duplicates) can report unified stage/overall
// progress with a throughput-based ETA, and so every other long-running
// entry point (rebuildIndex, detectObjects, exportDatabase, ...) has one
// place to ask "is something already running" instead of quietly racing
// against it - see app.ts's rejectIfBusy.
export interface StageDef {
    key: string;
    label: string;
}

export interface StageSnapshot {
    key: string;
    label: string;
    index: number;
    count: number;
    processed: number;
    total: number;
    startedAt: number;
}

export interface PipelineSnapshot {
    running: boolean;
    kind: string | null;
    startedAt: number | null;
    stage: StageSnapshot | null;
    // Throughput-based estimate (elapsed/processed * remaining), null until
    // the current stage has processed at least one item - a stage with an
    // unknown total (e.g. the folder-scan stage) never gets one.
    etaStageMs: number | null;
    // Projected from how far through the whole stage sequence the run is
    // (stageIndex + stageFraction) / stageCount - coarser than the stage
    // ETA, but the only thing available before every stage's real size is
    // known.
    etaOverallMs: number | null;
}

export type ProgressListener = (snapshot: PipelineSnapshot) => void;
export type DoneListener = (result: { kind: string; error: string | null }) => void;

let running = false;
let kind: string | null = null;
let overallStartedAt: number | null = null;
let stages: StageDef[] = [];
let stageIndex = -1;
let stageStartedAt: number | null = null;
let processed = 0;
let total = 0;

let onProgress: ProgressListener | null = null;
let onDone: DoneListener | null = null;

// app.ts calls this once at startup to wire snapshots/results to IPC sends
// (and menu updates) - kept as a listener rather than importing electron
// here so this module stays a plain state machine, testable without a
// BrowserWindow.
export const configure = (listeners: { onProgress: ProgressListener; onDone: DoneListener }): void => {
    onProgress = listeners.onProgress;
    onDone = listeners.onDone;
};

export const isRunning = (): boolean => running;
export const currentKind = (): string | null => kind;

// Returns false (and leaves state untouched) if a run is already in
// progress - the caller decides what "busy" means to its user (reject vs.
// queue); this module only guarantees two runs can never overlap.
export const begin = (runKind: string, stageDefs: StageDef[]): boolean => {
    if (running) return false;
    running = true;
    kind = runKind;
    stages = stageDefs;
    stageIndex = -1;
    stageStartedAt = null;
    processed = 0;
    total = 0;
    overallStartedAt = Date.now();
    emit();
    return true;
};

// total may be 0/unknown at first (e.g. the folder scan, or a batch whose
// size isn't known until the first query resolves) - pass whatever's known
// now, updateStage can raise it later.
export const startStage = (key: string, knownTotal: number = 0): void => {
    if (!running) return;
    stageIndex = stages.findIndex((s) => s.key === key);
    stageStartedAt = Date.now();
    processed = 0;
    total = knownTotal;
    emit();
};

export const updateStage = (processedCount: number, knownTotal?: number): void => {
    if (!running) return;
    processed = processedCount;
    if (knownTotal !== undefined) total = knownTotal;
    emit();
};

const endRun = (error: string | null): void => {
    if (!running) return;
    running = false;
    const finishedKind = kind;
    kind = null;
    stageIndex = -1;
    stageStartedAt = null;
    processed = 0;
    total = 0;
    if (onDone) onDone({ kind: finishedKind as string, error });
};

export const finish = (): void => endRun(null);
export const fail = (error: string): void => endRun(error);
// Same as fail, but for a run that never really got going (e.g. the user
// cancelled the folder-choose dialog) - kept as a distinct name so call
// sites read as intent, not error handling.
export const cancel = (message: string = "Cancelled"): void => endRun(message);

const emit = (): void => {
    if (!onProgress) return;
    const now = Date.now();
    const stage = stageIndex >= 0 ? stages[stageIndex] : null;
    const stageElapsed = stageStartedAt ? now - stageStartedAt : 0;
    const etaStageMs = stage && total > 0 && processed > 0
        ? Math.max(0, Math.round((stageElapsed / processed) * (total - processed)))
        : null;

    const overallElapsed = overallStartedAt ? now - overallStartedAt : 0;
    const stageFraction = total > 0 ? processed / total : 0;
    const overallFraction = stages.length > 0 && stageIndex >= 0
        ? (stageIndex + stageFraction) / stages.length
        : 0;
    // Below ~2% in, elapsed/fraction is too noisy to call an estimate -
    // better to show nothing than a wildly wrong number.
    const etaOverallMs = overallFraction > 0.02
        ? Math.max(0, Math.round(overallElapsed / overallFraction - overallElapsed))
        : null;

    onProgress({
        running,
        kind,
        startedAt: overallStartedAt,
        stage: stage ? {
            key: stage.key,
            label: stage.label,
            index: stageIndex,
            count: stages.length,
            processed,
            total,
            startedAt: stageStartedAt as number,
        } : null,
        etaStageMs,
        etaOverallMs,
    });
};
