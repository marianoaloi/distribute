import path from "path";
import os from "os";
import { Worker } from "worker_threads";
import { memoryAwareLimit, TASK_MEMORY_ESTIMATE } from "../system/resourceLimits";

import type { PixelsResult } from "./imageTransform";

const WORKER_PATH = path.join(__dirname, "frameWorker.js");

// Workers only do Jimp pixel hashing (no model to load), so this can scale
// closer to core count; still capped to leave a core free for the main
// process/UI and avoid oversubscribing on modest machines. That's the
// ceiling free RAM is allowed to pull down from (see resourceLimits.ts) -
// never raised past it even on a machine with RAM to spare.
const POOL_SIZE_CPU_CEILING = Math.max(1, Math.min(8, os.cpus().length - 1));

// Resolved lazily at ensurePool() time (not at module load) so it reflects
// memory conditions when the pool is actually about to start doing work,
// not whatever was free when the app happened to start.
const resolvePoolSize = (): number => memoryAwareLimit(POOL_SIZE_CPU_CEILING, TASK_MEMORY_ESTIMATE.pixelHash);

export interface WorkerRequest {
    id: number;
    input: string;
}

export type WorkerResponse =
    | { id: number; ok: true; result: PixelsResult }
    | { id: number; ok: false; error: string };

interface Task {
    id: number;
    input: string;
    resolve: (result: PixelsResult) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

interface PoolEntry {
    worker: Worker;
    pending: Map<number, Task>;
    free: boolean;
}

let pool: PoolEntry[] | null = null;
const queue: Task[] = [];
let nextTaskId = 0;

// Jimp's decode (pure-JS, no native timeout of its own) has no upper bound
// on a single call - a handful of exotic/huge files scattered through a real
// library used to be able to wedge every worker in the pool at once with
// zero console output (nothing ever throws, so nothing logs, and the
// indexMediaBackground progress counter that drives loadSuperRecursive's
// "index" stage simply stops moving forever). A generous timeout turns that
// into a loud, specific, recoverable failure instead.
//
// Kept short (20s) rather than generous now that compute() retries on
// failure (see MAX_RETRIES below): most real timeouts turn out to be
// transient resource contention, not a genuinely bad file (see the
// 2026-08-25 investigation - the exact file that timed out at 60s decoded
// fine in 0.26s once run in isolation) - several short attempts recover
// from that faster than one long wait, at the cost of a genuinely-corrupt
// file taking longer to finally give up on.
const TASK_TIMEOUT_MS = 20_000;

// Total attempts for one compute() call is 1 + MAX_RETRIES = 11. Applies to
// every failure mode (timeout, worker crash, or Jimp itself throwing) - a
// permanently bad file just burns through all of them before compute()
// finally rejects, which mediaIndexer.js's existing try/catch already
// treats as a normal per-item failure (skip and move on).
const MAX_RETRIES = 10;

const findEntryForTask = (id: number): PoolEntry | undefined =>
    pool?.find((e) => e.pending.has(id));

const dispatchNext = (): void => {
    if (!queue.length || !pool) return;
    const entry = pool.find((e) => e.free);
    if (!entry) return;
    const task = queue.shift() as Task;
    entry.free = false;
    entry.pending.set(task.id, task);
    entry.worker.postMessage({ id: task.id, input: task.input } satisfies WorkerRequest);
};

// A hung worker's underlying Jimp call may still be running (or spinning)
// inside it forever - marking the slot free without killing the worker
// would let a second task share it, whose response could arrive interleaved
// with (or never, if the first call truly never returns) the stale one.
// terminate()+replace guarantees the pool actually gets its concurrency
// slot back, not just the appearance of one.
const replaceHungWorker = (entry: PoolEntry): void => {
    if (!pool) return;
    const index = pool.indexOf(entry);
    if (index === -1) return;
    entry.worker.terminate().catch(() => { });
    pool[index] = createWorkerEntry();
    dispatchNext();
};

function createWorkerEntry(): PoolEntry {
    const worker = new Worker(WORKER_PATH);
    const entry: PoolEntry = { worker, pending: new Map(), free: true };
    worker.on("message", (msg: WorkerResponse) => {
        const task = entry.pending.get(msg.id);
        // Not found means the timeout already fired (and replaced this
        // worker) before this late response arrived - nothing left to settle.
        if (!task) return;
        clearTimeout(task.timer);
        entry.pending.delete(msg.id);
        entry.free = true;
        if (msg.ok) task.resolve(msg.result);
        else task.reject(new Error(msg.error));
        dispatchNext();
    });
    worker.on("error", (error: Error) => {
        for (const task of entry.pending.values()) {
            clearTimeout(task.timer);
            task.reject(error);
        }
        entry.pending.clear();
        // An uncaught exception inside a Worker terminates it (Node's own
        // worker_threads behavior) - this entry's `worker` is already dead,
        // so marking it merely "free" would let the next dispatch
        // postMessage into a terminated worker instead of a working one,
        // silently defeating retry for whatever gets dispatched next.
        replaceHungWorker(entry);
    });
    return entry;
}

const ensurePool = (): PoolEntry[] => {
    if (!pool) pool = Array.from({ length: resolvePoolSize() }, createWorkerEntry);
    return pool;
};

// Single attempt - exactly the old compute() body. Never retries itself;
// that's compute()'s job below, which needs to see each individual failure
// to log/count it.
const attemptCompute = (input: string): Promise<PixelsResult> => new Promise((resolve, reject) => {
    ensurePool();
    const id = ++nextTaskId;
    const timer = setTimeout(() => {
        const entry = findEntryForTask(id);
        if (entry) {
            entry.pending.delete(id);
            reject(new Error(`Pixel hashing timed out after ${TASK_TIMEOUT_MS / 1000}s for ${input}`));
            replaceHungWorker(entry);
            return;
        }
        // Never got dispatched (pool was still saturated with other work) -
        // drop it from the queue instead of leaving it to wait forever; the
        // caller (mediaIndexer.js) treats this the same as any other failure.
        const queueIndex = queue.findIndex((t) => t.id === id);
        if (queueIndex !== -1) {
            queue.splice(queueIndex, 1);
            reject(new Error(`Pixel hashing timed out after ${TASK_TIMEOUT_MS / 1000}s waiting for a free worker for ${input}`));
        }
    }, TASK_TIMEOUT_MS);
    queue.push({ id, input, resolve, reject, timer });
    dispatchNext();
});

// input: file path to hash. Resolves { baseMd5, grey }.
export const compute = async (input: string): Promise<PixelsResult> => {
    let lastError: Error = new Error(`Pixel hashing failed for ${input}`);
    for (let attempt = 1; attempt <= 1 + MAX_RETRIES; attempt++) {
        try {
            return await attemptCompute(input);
        } catch (error) {
            lastError = error as Error;
            const willRetry = attempt <= MAX_RETRIES;
            console.error(
                `computePool: attempt ${attempt}/${1 + MAX_RETRIES} failed for ${input}: ${lastError.message}`
                + (willRetry ? " - retrying" : " - giving up"),
            );
        }
    }
    throw lastError;
};

// Terminates all pool workers, freeing the threads if the pool is no longer needed.
export const shutdown = async (): Promise<void> => {
    if (!pool) return;
    const workers = pool;
    pool = null;
    await Promise.all(workers.map((entry) => entry.worker.terminate()));
};
