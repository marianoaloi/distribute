// Most failed file paths a pass keeps for its result (the headless LSR lists
// them in its end summary; every failure is in the log anyway).
export const FAILED_PATHS_CAP = 100;

export const pushCapped = (list: string[], filePath: string): void => {
    if (list.length < FAILED_PATHS_CAP) list.push(filePath);
};
