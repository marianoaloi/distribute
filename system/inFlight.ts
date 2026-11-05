// Which files the long-running workers are working on right now. Used by the
// headless LSR runner to name the file(s) involved when an error escapes
// every handler (uncaught exception / unhandled rejection), so a bad file
// can be found in the run log. Cheap: a Set add/delete per item.
const active = new Map<string, number>();

export const begin = (filePath: string): void => {
    active.set(filePath, (active.get(filePath) ?? 0) + 1);
};

export const end = (filePath: string): void => {
    const n = (active.get(filePath) ?? 0) - 1;
    if (n > 0) active.set(filePath, n);
    else active.delete(filePath);
};

// Runs fn with filePath registered as in flight for its whole duration.
export const track = async <T>(filePath: string, fn: () => Promise<T>): Promise<T> => {
    begin(filePath);
    try {
        return await fn();
    } finally {
        end(filePath);
    }
};

export const snapshot = (): string[] => [...active.keys()];
