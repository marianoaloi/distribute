const path = require("path");
const os = require("os");
const { Worker } = require("worker_threads");

const WORKER_PATH = path.join(__dirname, "frameWorker.js");

// Workers only do Jimp pixel hashing (no model to load), so this can scale
// closer to core count; still capped to leave a core free for the main
// process/UI and avoid oversubscribing on modest machines.
const POOL_SIZE = Math.max(1, Math.min(8, os.cpus().length - 1));

let pool = null;
const queue = [];
let nextTaskId = 0;

const dispatchNext = () => {
    if (!queue.length) return;
    const entry = pool.find((e) => e.free);
    if (!entry) return;
    const task = queue.shift();
    entry.free = false;
    entry.pending.set(task.id, task);
    entry.worker.postMessage({ id: task.id, input: task.input });
};

const createWorkerEntry = () => {
    const worker = new Worker(WORKER_PATH);
    const entry = { worker, pending: new Map(), free: true };
    worker.on("message", (msg) => {
        const task = entry.pending.get(msg.id);
        if (!task) return;
        entry.pending.delete(msg.id);
        entry.free = true;
        if (msg.ok) task.resolve(msg.result);
        else task.reject(new Error(msg.error));
        dispatchNext();
    });
    worker.on("error", (error) => {
        for (const task of entry.pending.values()) task.reject(error);
        entry.pending.clear();
        entry.free = true;
        dispatchNext();
    });
    return entry;
};

const ensurePool = () => {
    if (!pool) pool = Array.from({ length: POOL_SIZE }, createWorkerEntry);
    return pool;
};

// input: file path to hash. Resolves { baseMd5, blurMd5 }.
const compute = (input) => new Promise((resolve, reject) => {
    ensurePool();
    queue.push({ id: ++nextTaskId, input, resolve, reject });
    dispatchNext();
});

// Terminates all pool workers. Not required for a clean process exit (unlike
// the CLIP/onnxruntime work, which must stay off worker threads entirely —
// see frameWorker.js), but frees the threads if the pool is no longer needed.
const shutdown = async () => {
    if (!pool) return;
    const workers = pool;
    pool = null;
    await Promise.all(workers.map((entry) => entry.worker.terminate()));
};

module.exports = {
    compute,
    shutdown,
};
