import { parentPort } from "worker_threads";
import { pixelsFor } from "./imageTransform";
import type { WorkerRequest, WorkerResponse } from "./computePool";

// Runs the pixel hashing (Jimp resize/crop/blur/md5) off the Electron main
// thread. One task at a time per worker; computePool.js owns queueing and
// dispatch across the worker pool.
if (!parentPort) throw new Error("frameWorker.ts must be run as a worker_threads Worker");

parentPort.on("message", async ({ id, input }: WorkerRequest) => {
    try {
        const result = await pixelsFor(input);
        parentPort!.postMessage({ id, ok: true, result } satisfies WorkerResponse);
    } catch (error) {
        parentPort!.postMessage({ id, ok: false, error: (error as Error).message } satisfies WorkerResponse);
    }
});
