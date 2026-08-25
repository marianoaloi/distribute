import path from "path";
import os from "os";
import { Worker } from "worker_threads";

import type { PixelsResult } from "./imageTransform";

const WORKER_PATH = path.join(__dirname, "frameWorker.js");

// Workers only do Jimp pixel hashing (no model to load), so this can scale
// closer to core count; still capped to leave a core free for the main
// process/UI and avoid oversubscribing on modest machines.
const POOL_SIZE = Math.max(1, Math.min(8, os.cpus().length - 1));

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
const TASK_TIMEOUT_MS = 60_000;

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
        entry.free = true;
        dispatchNext();
    });
    return entry;
}

const ensurePool = (): PoolEntry[] => {
    if (!pool) pool = Array.from({ length: POOL_SIZE }, createWorkerEntry);
    return pool;
};

// input: file path to hash. Resolves { baseMd5, grey }.
export const compute = (input: string): Promise<PixelsResult> => new Promise((resolve, reject) => {
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

// Terminates all pool workers, freeing the threads if the pool is no longer needed.
export const shutdown = async (): Promise<void> => {
    if (!pool) return;
    const workers = pool;
    pool = null;
    await Promise.all(workers.map((entry) => entry.worker.terminate()));
};
