// Graceful stop for the headless LSR runner. The first SIGINT/SIGTERM only
// raises a flag that every long loop polls (between folders, pages and
// stages), so in-flight items finish and their results are persisted; a
// re-run picks up where this one stopped. A second signal exits at once.
export const EXIT_INTERRUPTED = 130;

export interface StopControl {
    shouldStop(): boolean;
    // Which signal requested the stop, or null.
    reason(): string | null;
    dispose(): void;
}

// onForced runs synchronously right before the forced exit (second
// signal): the place to write a last log line and release the lock - the
// buffered run log would otherwise lose its tail.
export const installStopHandlers = (
    onFirst: (signal: string) => void,
    proc: Pick<NodeJS.Process, "on" | "off" | "exit"> = process,
    onForced?: (signal: string) => void,
): StopControl => {
    let stopSignal: string | null = null;
    const handler = (signal: NodeJS.Signals): void => {
        if (stopSignal !== null) {
            try { onForced?.(signal); } catch { /* exiting anyway */ }
            proc.exit(EXIT_INTERRUPTED);
            return;
        }
        stopSignal = signal;
        onFirst(signal);
    };
    proc.on("SIGINT", handler);
    proc.on("SIGTERM", handler);
    return {
        shouldStop: () => stopSignal !== null,
        reason: () => stopSignal,
        dispose: () => { proc.off("SIGINT", handler); proc.off("SIGTERM", handler); },
    };
};
