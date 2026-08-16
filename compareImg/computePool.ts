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
}

interface PoolEntry {
    worker: Worker;
    pending: Map<number, Task>;
    free: boolean;
}

let pool: PoolEntry[] | null = null;
const queue: Task[] = [];
let nextTaskId = 0;

const dispatchNext = (): void => {
    if (!queue.length || !pool) return;
    const entry = pool.find((e) => e.free);
    if (!entry) return;
    const task = queue.shift() as Task;
    entry.free = false;
    entry.pending.set(task.id, task);
    entry.worker.postMessage({ id: task.id, input: task.input } satisfies WorkerRequest);
};

const createWorkerEntry = (): PoolEntry => {
    const worker = new Worker(WORKER_PATH);
    const entry: PoolEntry = { worker, pending: new Map(), free: true };
    worker.on("message", (msg: WorkerResponse) => {
        const task = entry.pending.get(msg.id);
        if (!task) return;
        entry.pending.delete(msg.id);
        entry.free = true;
        if (msg.ok) task.resolve(msg.result);
        else task.reject(new Error(msg.error));
        dispatchNext();
    });
    worker.on("error", (error: Error) => {
        for (const task of entry.pending.values()) task.reject(error);
        entry.pending.clear();
        entry.free = true;
        dispatchNext();
    });
    return entry;
};

const ensurePool = (): PoolEntry[] => {
    if (!pool) pool = Array.from({ length: POOL_SIZE }, createWorkerEntry);
    return pool;
};

// input: file path to hash. Resolves { baseMd5, grey }.
export const compute = (input: string): Promise<PixelsResult> => new Promise((resolve, reject) => {
    ensurePool();
    queue.push({ id: ++nextTaskId, input, resolve, reject });
    dispatchNext();
});

// Terminates all pool workers, freeing the threads if the pool is no longer needed.
export const shutdown = async (): Promise<void> => {
    if (!pool) return;
    const workers = pool;
    pool = null;
    await Promise.all(workers.map((entry) => entry.worker.terminate()));
};
