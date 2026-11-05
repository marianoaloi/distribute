// "extraDups" stage of the headless LSR: the GUI's three on-demand duplicate
// algorithms (shared detection boxes, identical per-frame signature, shared
// blurred frames), run once each. They are SQL-aggregated in HashStore and
// not persisted - the GUI recomputes them on demand - so the result is kept
// in memory for the "report" stage of the same run (which recomputes them
// itself when run alone).
//
// Each runs in its own child process (cli/extraDupsChild.ts) with a time
// budget: the queries are synchronous and uninterruptible, and on a big
// library of very similar media one can run for hours. Over budget, or on a
// stop request, the child is SIGKILLed. One failing algorithm never stops
// the others.
import path from "path";
import { fork, type ChildProcess } from "child_process";

export type ExtraAlgorithm = "objects" | "frames" | "blurFrames";

export const EXTRA_ALGORITHMS: readonly ExtraAlgorithm[] = ["objects", "frames", "blurFrames"];

export interface ExtraResult {
    algorithm: ExtraAlgorithm;
    groups: string[][];
    elapsedMs: number;
    error?: string;
}

// Per-algorithm time budget; override with LSR_EXTRA_DUPS_MINUTES.
export const DEFAULT_EXTRA_DUPS_MINUTES = 60;
export const extraDupsBudgetMs = (env: NodeJS.ProcessEnv): number => {
    const minutes = Number(env.LSR_EXTRA_DUPS_MINUTES);
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_EXTRA_DUPS_MINUTES) * 60_000;
};

export class StoppedError extends Error { }

const POLL_MS = 500;

export interface RunOptions {
    budgetMs: number;
    shouldStop(): boolean;
    // Called every POLL_MS while the child runs (keeps a watchdog fed: the
    // budget, not the watchdog, bounds a long query).
    onTick?(): void;
}

// Children still running - killed if the runner exits first (a forced
// second-signal exit, a fatal error), so no query outlives the run.
const liveChildren = new Set<ChildProcess>();
process.on("exit", () => { for (const child of liveChildren) child.kill("SIGKILL"); });

const formatBudget = (ms: number): string => ms >= 60_000 ? `${Math.round(ms / 6000) / 10} min` : `${Math.round(ms / 1000)}s`;

// Runs one algorithm in a child process (the same Electron binary, as
// node); rejects on error, on timeout and (with StoppedError) on a stop
// request.
export const runInChild = (root: string, algorithm: ExtraAlgorithm, options: RunOptions): Promise<string[][]> =>
    new Promise<string[][]>((resolve, reject) => {
        const child = fork(path.join(__dirname, "extraDupsChild.js"), [root, algorithm, String(process.pid)], {
            execPath: process.execPath,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
            stdio: ["ignore", "ignore", "pipe", "ipc"],
        });
        liveChildren.add(child);
        let stderr = "";
        child.stderr?.on("data", (chunk: Buffer) => { if (stderr.length < 4000) stderr += chunk.toString(); });
        const started = Date.now();
        let settled = false;
        const settle = (fn: () => void): void => {
            if (settled) return;
            settled = true;
            clearInterval(poll);
            fn();
        };
        const kill = (): void => { child.kill("SIGKILL"); };
        const poll = setInterval(() => {
            options.onTick?.();
            if (options.shouldStop()) settle(() => { kill(); reject(new StoppedError("stopped")); });
            else if (Date.now() - started > options.budgetMs) {
                settle(() => { kill(); reject(new Error(`timed out after ${formatBudget(options.budgetMs)} (LSR_EXTRA_DUPS_MINUTES)`)); });
            }
        }, POLL_MS);
        child.on("message", (message: { groups?: string[][]; error?: string }) => settle(() => {
            if (message.error !== undefined) reject(new Error(message.error));
            else resolve(message.groups ?? []);
        }));
        child.once("error", (error) => settle(() => reject(error)));
        child.once("exit", (code, signal) => {
            liveChildren.delete(child);
            settle(() => reject(new Error(`exited (${signal ?? `code ${code}`}) before answering${stderr ? `: ${stderr.trim().split("\n").slice(-3).join(" | ")}` : ""}`)));
        });
    });

export const runExtraDuplicates = async (options: {
    shouldStop(): boolean;
    // Runs one algorithm; injectable for tests (the runner uses runInChild).
    run: (algorithm: ExtraAlgorithm) => Promise<string[][]>;
    now?: () => number;
    onStep?: (done: number, total: number) => void;
}): Promise<{ results: ExtraResult[]; stopped: boolean }> => {
    const now = options.now ?? Date.now;
    const results: ExtraResult[] = [];
    for (const algorithm of EXTRA_ALGORITHMS) {
        if (options.shouldStop()) return { results, stopped: true };
        const started = now();
        console.log(`lsr extraDups: running ${algorithm}`);
        try {
            const groups = await options.run(algorithm);
            results.push({ algorithm, groups, elapsedMs: now() - started });
            console.log(`lsr extraDups: ${algorithm} found ${groups.length} groups in ${now() - started}ms`);
        } catch (error) {
            if (error instanceof StoppedError) return { results, stopped: true };
            results.push({ algorithm, groups: [], elapsedMs: now() - started, error: (error as Error).message });
            console.error(`lsr extraDups: ${algorithm} failed -`, (error as Error).message);
        }
        options.onStep?.(results.length, EXTRA_ALGORITHMS.length);
    }
    return { results, stopped: false };
};

export const formatExtraSummary = (results: readonly ExtraResult[]): string =>
    results.length === 0 ? "no algorithm finished" : results.map(r => r.error ? `${r.algorithm}: FAILED (${r.error})` : `${r.algorithm}: ${r.groups.length} groups`).join(", ");
