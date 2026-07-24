const { parentPort } = require("worker_threads");
const imageTransform = require("./imageTransform");

// Runs the pixel hashing (Jimp resize/crop/blur/md5) off the Electron main
// thread. CLIP embedding stays on the main thread instead: onnxruntime's
// native session isn't safe to tear down from inside a worker_thread — it
// segfaults the whole process on worker termination or even a plain
// process.exit(0), which is exactly what app.js does on window-all-closed.
// One task at a time per worker; computePool.js owns queueing and dispatch.
parentPort.on("message", async ({ id, input }) => {
    try {
        const result = await imageTransform.md5sFor(input);
        parentPort.postMessage({ id, ok: true, result });
    } catch (error) {
        parentPort.postMessage({ id, ok: false, error: error.message });
    }
});
