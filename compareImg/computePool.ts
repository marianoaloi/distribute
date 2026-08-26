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

// Re-read on every dispatch, NOT frozen when the pool is first built -
// matching the acquire/release pattern videoFrames.ts already uses for its
// ffmpeg limit. Resolving it once (which is what ensurePool() used to do)
// quietly defeated the entire point of memoryAwareLimit reading os.freemem()
// live: a run that started with headroom sized the pool to 6 and then kept
// all 6 workers decoding 21MP images long after free memory had fallen to
// the point where only 1 fit. Memory conditions at the moment the first
// image happens to be hashed are not a safe proxy for conditions an hour
// into indexing a large library.
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
    // Null while the task is still queued; armed by dispatchTo() at the
    // moment a worker actually takes the file, so it bounds how long that
    // WORKER gets, never how long the caller queued. Fires at
    // SOFT_TIMEOUT_MS to reject the caller while leaving the worker running.
    softTimer: NodeJS.Timeout | null;
    // Only set once actually dispatched to a worker (see dispatchTo) -
    // fires at HARD_TIMEOUT_MS if that worker still hasn't responded, and
    // is what actually recycles it. Cleared the moment a real response
    // arrives, whether or not the soft timeout already settled the caller.
    hardTimer: NodeJS.Timeout | null;
    // True once the caller's promise has been resolved/rejected (by a real
    // response OR the soft timeout, whichever comes first) - guards against
    // settling twice when a late response arrives after the soft timeout
    // already gave up on the caller's behalf.
    settled: boolean;
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
// "index" stage simply stops moving forever).
//
// Two tiers rather than one, learned the hard way (see the 2026-08-25
// investigation): under real sustained memory pressure, EVERY concurrent
// decode timed out on EVERY retry, in lockstep, and the whole main process
// then went silent for 12 minutes. The cause was this file's own old
// behavior - killing and recreating a whole Worker thread (a fresh V8
// isolate, re-requiring Jimp) on every single timeout, for tasks that were
// most likely still genuinely running, just slow under contention - which
// added load at exactly the moment the system needed less.
//
// SOFT: how long the CALLER waits before compute() gives up on this attempt
// and lets its retry loop move on - keeps the pipeline responsive. The
// worker itself is left running; if it finishes late, the result is just
// discarded (see the `settled` guard below), no worse than never having
// tried.
// HARD: only fires if the worker genuinely never responds even after this
// much longer grace period - that's the actual "recycle a dead thread"
// case, kept rare and expensive-only-when-necessary rather than the default
// path.
const SOFT_TIMEOUT_MS = 10_000;
const HARD_TIMEOUT_MS = 5 * 20_000;

// Total attempts for one compute() call is 1 + MAX_RETRIES = 11. Applies to
// every failure mode (timeout, worker crash, or Jimp itself throwing) - a
// permanently bad file just burns through all of them before compute()
// finally rejects, which mediaIndexer.js's existing try/catch already
// treats as a normal per-item failure (skip and move on).
const MAX_RETRIES = 10;

// Backoff between retries - also learned from the same investigation:
// retrying instantly, 6-at-a-time, in lockstep, gave an already-starved
// system zero chance to recover before being hit again. Linear and capped
// rather than anything fancier - just enough breathing room, not minutes of
// added latency for a real per-file problem.
const RETRY_BACKOFF_STEP_MS = 1_000;
const RETRY_BACKOFF_CAP_MS = 10_000;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Terminates idle workers once the live limit has fallen below the number
// we've grown to - each one holds a V8 isolate (~40MB with Jimp loaded)
// that is pure overhead we can hand back to a machine that has just told us
// it is short on memory. Busy workers are left alone; they'll be reaped by
// this same check the next time they come free.
const shrinkIdleWorkers = (limit: number): void => {
    if (!pool) return;
    for (let i = pool.length - 1; i >= 0 && pool.length > limit; i--) {
        if (!pool[i].free || pool[i].pending.size) continue;
        pool[i].worker.terminate().catch(() => { });
        pool.splice(i, 1);
    }
};

const dispatchNext = (): void => {
    if (!pool) return;
    // Loop rather than dispatching a single task: capacity can open up by
    // more than one slot at a time (the pool growing, or free memory
    // recovering between calls), and a one-shot dispatch would leave that
    // capacity idle until the next unrelated event happened to poke it.
    while (queue.length) {
        const limit = resolvePoolSize();
        shrinkIdleWorkers(limit);
        const busy = pool.reduce((n, e) => n + (e.free ? 0 : 1), 0);
        // The real concurrency gate now. Workers beyond this many would be
        // competing for RAM the machine does not currently have, which is
        // slower than simply waiting - see TASK_MEMORY_ESTIMATE.pixelHash.
        if (busy >= limit) return;
        let entry = pool.find((e) => e.free);
        if (!entry) {
            // busy < limit and nothing free means the pool hasn't grown to
            // the limit yet. Grow one at a time, on demand, so a run that
            // never sees memory pressure still reaches full width while one
            // that starts constrained never pays for isolates it can't use.
            entry = createWorkerEntry();
            pool.push(entry);
        }
        dispatchTo(entry, queue.shift() as Task);
    }
};

const dispatchTo = (entry: PoolEntry, task: Task): void => {
    entry.free = false;
    entry.pending.set(task.id, task);
    // Armed here rather than in attemptCompute, so it measures how long the
    // WORKER has had this file - not how long the caller has been waiting
    // in total. Time spent queued behind other work is ordinary backpressure
    // and must not count against the file: in the 2026-08-25 follow-up,
    // 10 of the 11 attempts on each dropped image failed with "waiting for
    // a free worker", i.e. the retry budget was burned without the file
    // ever being handed to a worker even once, and a perfectly readable
    // image was discarded on the strength of it.
    task.softTimer = setTimeout(() => {
        if (task.settled) return; // real response (or the hard timeout) already won the race
        task.settled = true;
        // Deliberately does not touch the worker or entry.pending: it may
        // well still be genuinely working (just slow under contention) and
        // will either finish late (dropped via the `settled` guard in the
        // message handler) or eventually get recycled by its own hardTimer
        // if it truly never responds.
        task.reject(new Error(`Pixel hashing timed out after ${SOFT_TIMEOUT_MS / 1000}s for ${task.input} (worker still running in background)`));
    }, SOFT_TIMEOUT_MS);
    // Only armed once actually handed to a worker - see the Task.hardTimer
    // doc comment. Cast: `entry` stays valid inside this closure (workers
    // are only ever replaced by identity, never mutated in place).
    task.hardTimer = setTimeout(() => {
        if (!task.settled) {
            task.settled = true;
            task.reject(new Error(`Pixel hashing hard-timed out after ${HARD_TIMEOUT_MS / 1000}s for ${task.input} (worker never responded)`));
        }
        entry.pending.delete(task.id);
        replaceHungWorker(entry);
    }, HARD_TIMEOUT_MS);
    entry.worker.postMessage({ id: task.id, input: task.input } satisfies WorkerRequest);
};

// A genuinely dead/stuck-forever worker's Jimp call may still be spinning
// inside it - marking the slot free without killing the worker would let a
// second task share it, whose response could arrive interleaved with (or
// never, since the first call truly never returns) the stale one.
// terminate()+replace guarantees the pool actually gets its concurrency
// slot back, not just the appearance of one. Only called from the hard
// timeout and worker 'error' paths now - NOT on every soft timeout (see
// SOFT_TIMEOUT_MS's doc comment for why that used to make real contention
// worse, not better).
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
        // Not found means the hard timeout already fired (and replaced this
        // worker) before this very-late response arrived - nothing left to
        // settle.
        if (!task) return;
        if (task.hardTimer) clearTimeout(task.hardTimer);
        if (task.softTimer) clearTimeout(task.softTimer);
        entry.pending.delete(msg.id);
        entry.free = true;
        if (!task.settled) {
            // Common case: this response beat the soft timeout, so the
            // caller is still waiting on it directly.
            task.settled = true;
            if (msg.ok) task.resolve(msg.result);
            else task.reject(new Error(msg.error));
        }
        // else: the soft timeout already rejected the caller, which has
        // likely already moved on to a retry - this result just gets
        // dropped, same as it would if the worker had failed outright.
        dispatchNext();
    });
    worker.on("error", (error: Error) => {
        for (const task of entry.pending.values()) {
            if (task.hardTimer) clearTimeout(task.hardTimer);
            if (task.softTimer) clearTimeout(task.softTimer);
            if (!task.settled) {
                task.settled = true;
                task.reject(error);
            }
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

// Creates the pool with a single worker; dispatchNext() grows it on demand
// up to whatever the live limit allows. The width is no longer decided here
// (see resolvePoolSize) - this only guarantees `pool` is non-null so the
// dispatch path has something to grow from.
const ensurePool = (): PoolEntry[] => {
    if (!pool) pool = [createWorkerEntry()];
    return pool;
};

// Single attempt - never retries itself; that's compute()'s job below,
// which needs to see each individual failure to log/back off/count it.
const attemptCompute = (input: string): Promise<PixelsResult> => new Promise((resolve, reject) => {
    ensurePool();
    const id = ++nextTaskId;
    // softTimer stays null until dispatchTo() arms it. A task waiting its
    // turn is not failing, so it is given no deadline at all here: the pool
    // always keeps at least one worker, and any worker that truly wedges is
    // recycled by its hardTimer, so the queue is always guaranteed to drain.
    const task: Task = { id, input, resolve, reject, softTimer: null, hardTimer: null, settled: false };
    queue.push(task);
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
            if (willRetry) {
                const backoffMs = Math.min(RETRY_BACKOFF_CAP_MS, RETRY_BACKOFF_STEP_MS * attempt);
                console.error(
                    `computePool: attempt ${attempt}/${1 + MAX_RETRIES} failed for ${input}: ${lastError.message}`
                    + ` - retrying in ${backoffMs}ms`,
                );
                await sleep(backoffMs);
            } else {
                console.error(`computePool: attempt ${attempt}/${1 + MAX_RETRIES} failed for ${input}: ${lastError.message} - giving up`);
            }
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
