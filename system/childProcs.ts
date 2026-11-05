// Child processes (ffmpeg) the shared workers spawned and that are still
// running. A run that ends while one is stuck - e.g. ffmpeg blocked reading
// a FIFO, which also ignores SIGTERM - would otherwise leave it running
// forever; the headless LSR SIGKILLs every one left on any exit path.
import type { ChildProcess } from "child_process";

const live = new Set<ChildProcess>();

export const track = <T extends ChildProcess>(child: T): T => {
    live.add(child);
    const forget = (): void => { live.delete(child); };
    child.once("exit", forget);
    child.once("error", forget);
    return child;
};

// SIGKILLs every tracked child still running; returns how many.
export const killAll = (): number => {
    let killed = 0;
    for (const child of live) {
        try { if (child.kill("SIGKILL")) killed++; } catch { /* already gone */ }
    }
    live.clear();
    return killed;
};

export const liveCount = (): number => live.size;
