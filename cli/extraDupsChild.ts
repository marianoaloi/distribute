// Child process running ONE of the extra duplicate algorithms for
// cli/extraDups.ts:  <electron as node> extraDupsChild.js <root> <algorithm> <parentPid>
// They are single synchronous SQLite queries that cannot be interrupted
// (better-sqlite3 has no interrupt), and some can run for hours on a big,
// highly similar library. Out of process, the runner stays responsive
// (signals, stall watchdog) and can SIGKILL a query that exceeds its time
// budget - a worker thread stuck in native code cannot be terminated, and
// would even keep process.exit from completing.
//
// It opens its own connection to the same index.db; the runner does not
// write while extraDups runs. The answer goes back over the IPC channel.
import { Worker } from "worker_threads";
import { setActiveFolder } from "../DirectorioCache";

// Parent watchdog (parentPid comes from the runner on the command line:
// if it already died before we got here, process.ppid would be 1). The query below blocks this thread inside native code, so
// no JS callback (IPC "disconnect", timers) can run here until it returns -
// and if the runner is SIGKILLed (kill -9, OOM killer) its exit handlers
// never kill us either. A worker thread has its own event loop: it polls
// every PARENT_POLL_MS and SIGKILLs this whole process once the parent is gone, so
// no hours-long query outlives the run.
export const PARENT_POLL_MS = 200;
const watchParent = (parentPid: number): void => {
    const worker = new Worker(`
        const { workerData } = require("worker_threads");
        const gone = () => {
            if (process.ppid !== workerData.parentPid) return true;
            try { process.kill(workerData.parentPid, 0); return false; } catch (e) { return e.code === "ESRCH"; }
        };
        setInterval(() => { if (gone()) process.kill(process.pid, "SIGKILL"); }, workerData.pollMs);
    `, { eval: true, workerData: { parentPid, pollMs: PARENT_POLL_MS } });
    // Must never keep the child alive once it is done.
    worker.unref();
};

const ALGORITHMS = ["objects", "frames", "blurFrames"] as const;

const main = async (): Promise<void> => {
    const [root, algorithm, parentPidArg] = process.argv.slice(2);
    const parentPid = Number(parentPidArg);
    const send = (message: unknown): Promise<void> => new Promise(resolve => {
        if (!process.send) { resolve(); return; }
        process.send(message, undefined, undefined, () => resolve());
    });
    if (!root || !(ALGORITHMS as readonly string[]).includes(algorithm)) {
        await send({ error: `usage: extraDupsChild.js <root> <${ALGORITHMS.join("|")}>` });
        process.exit(2);
    }
    if (Number.isInteger(parentPid) && parentPid > 1) watchParent(parentPid);
    setActiveFolder(root);
    const HashStore = await import("../compareImg/HashStore");
    const db = HashStore.useReadOnlyConnection();
    // Sort/temp space on disk, and SQLite's own heap capped (the JS heap is
    // capped by the runner's --max-old-space-size): a pathological query
    // fails with "out of memory" instead of eating the shared server.
    db.pragma("temp_store = FILE");
    const maxMb = Number(process.env.LSR_EXTRA_DUPS_MAX_MB);
    if (Number.isFinite(maxMb) && maxMb > 0) db.pragma(`hard_heap_limit = ${Math.floor(maxMb * 1024 * 1024)}`);
    const duplicateFinder = await import("../compareImg/duplicateFinder");
    const find = {
        objects: duplicateFinder.findObjectDuplicates,
        frames: duplicateFinder.findFrameDuplicates,
        blurFrames: duplicateFinder.findBlurFrameDuplicates,
    }[algorithm as typeof ALGORITHMS[number]];
    try {
        await send({ groups: find() });
    } catch (error) {
        await send({ error: (error as Error).message });
    }
    try { HashStore.closeConnection(); } catch { /* exiting */ }
    process.exit(0);
};

main();
