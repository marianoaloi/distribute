// Terminal progress lines for the headless LSR runner, fed by
// pipeline/PipelineRun.ts's snapshots (the same stage/ETA state machine the
// GUI's banner uses). Throttled: one line per stage change, then at most one
// per intervalMs - PipelineRun emits on every processed item.
import type { PipelineSnapshot } from "../pipeline/PipelineRun";

export const formatDuration = (ms: number): string => {
    if (!Number.isFinite(ms) || ms < 0) return "?";
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h${String(m % 60).padStart(2, "0")}m`;
    return `${Math.floor(h / 24)}d${String(h % 24).padStart(2, "0")}h`;
};

export const formatRate = (perSecond: number): string =>
    perSecond >= 10 ? `${Math.round(perSecond)}/s` : `${perSecond.toFixed(1)}/s`;

// One status line, e.g.
//   [2/5 hash 12.3%] 1500/12000  85/s  ETA 2m03s  overall ETA 1h10m
//   [1/5 scan] 4200 items  310/s
export const formatSnapshot = (snapshot: PipelineSnapshot, now: number): string | null => {
    const stage = snapshot.stage;
    if (!stage) return null;
    const elapsedS = Math.max(0.001, (now - stage.startedAt) / 1000);
    const rate = formatRate(stage.processed / elapsedS);
    const head = `[${stage.index + 1}/${stage.count} ${stage.key}`;
    const parts: string[] = [];
    if (stage.total > 0) {
        const pct = Math.min(100, (stage.processed / stage.total) * 100).toFixed(1);
        parts.push(`${head} ${pct}%] ${stage.processed}/${stage.total}`, rate);
    } else {
        parts.push(`${head}] ${stage.processed} items`, rate);
    }
    if (snapshot.etaStageMs !== null) parts.push(`ETA ${formatDuration(snapshot.etaStageMs)}`);
    if (snapshot.etaOverallMs !== null) parts.push(`overall ETA ${formatDuration(snapshot.etaOverallMs)}`);
    return parts.join("  ");
};

export interface Reporter {
    onProgress(snapshot: PipelineSnapshot): void;
    // Forces the latest snapshot out (e.g. right before a stage summary).
    flush(): void;
}

export const createReporter = (write: (line: string) => void, options: { intervalMs?: number; now?: () => number } = {}): Reporter => {
    const intervalMs = options.intervalMs ?? 5000;
    const now = options.now ?? Date.now;
    let lastStageKey: string | null = null;
    let lastPrinted = 0;
    let latest: PipelineSnapshot | null = null;
    let latestPrinted = true;

    const print = (snapshot: PipelineSnapshot): void => {
        const line = formatSnapshot(snapshot, now());
        if (line) write(line);
        lastPrinted = now();
        latestPrinted = true;
    };

    return {
        onProgress: (snapshot) => {
            latest = snapshot;
            latestPrinted = false;
            const key = snapshot.stage?.key ?? null;
            if (key !== lastStageKey) {
                lastStageKey = key;
                print(snapshot);
            } else if (now() - lastPrinted >= intervalMs) {
                print(snapshot);
            }
        },
        flush: () => { if (latest && !latestPrinted) print(latest); },
    };
};
