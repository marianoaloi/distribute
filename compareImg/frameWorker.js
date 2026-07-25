const { parentPort } = require("worker_threads");
const imageTransform = require("./imageTransform");

// Runs the pixel hashing (Jimp resize/crop/blur/md5) off the Electron main
// thread. One task at a time per worker; computePool.js owns queueing and
// dispatch across the worker pool.
parentPort.on("message", async ({ id, input }) => {
    try {
        const result = await imageTransform.md5sFor(input);
        parentPort.postMessage({ id, ok: true, result });
    } catch (error) {
        parentPort.postMessage({ id, ok: false, error: error.message });
    }
});
