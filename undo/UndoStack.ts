import fs from "fs";

// Undo for file moves, kept in the main process rather than in renderer redux
// because everything it has to put back is main-process state: the files on
// disk and media.futurePosition. It also has to survive a renderer reload -
// View > Reload sits right in the menu, and a redux-held stack would silently
// vanish with it.
//
// Only MOVES are recorded. A copy's inverse would be deleting a file the user
// may have edited since, which is a destructive "undo" - the wrong trade, so
// copies are simply never pushed.

export interface MoveEntry {
    mediaId: string;
    /** Where the file was before the move - localPath, and where undo puts it back. */
    from: string;
    /** Where the move put it - media.futurePosition, and where undo reads it from. */
    to: string;
}

// One user action. A single click can produce two separate "process" IPC
// messages (folder.tsx's split move sends the checked and unchecked halves
// independently), so batches are keyed by an id the renderer generates per
// action rather than per message - otherwise undoing one click would take two
// Ctrl+Z presses.
interface MoveBatch {
    batchId: string;
    at: number;
    /** Destination folder name, for the menu label. */
    folder: string;
    entries: MoveEntry[];
}

export interface UndoOutcome {
    restored: number;
    /** Files that could not be put back, with the reason - never silently dropped. */
    skipped: Array<{ mediaId: string; from: string; to: string; reason: string }>;
}

// Entries are only metadata, but ones pointing at long-gone paths are noise
// rather than a usable offer, so the history stays shallow.
const MAX_BATCHES = 20;

let batches: MoveBatch[] = [];

// A batch stays open while moveFile's per-file fs callbacks land, so successes
// accumulate into one entry instead of arriving as N single-file batches.
const openBatch = (batchId: string, folder: string): MoveBatch => {
    const existing = batches.find((b) => b.batchId === batchId);
    if (existing) return existing;

    const batch: MoveBatch = { batchId, at: Date.now(), folder, entries: [] };
    batches.push(batch);
    if (batches.length > MAX_BATCHES) batches = batches.slice(-MAX_BATCHES);
    return batch;
};

export const recordMove = (batchId: string, folder: string, entry: MoveEntry): void => {
    openBatch(batchId, folder).entries.push(entry);
};

// A batch with no successful move in it (every file failed) is not something
// the user can meaningfully undo, so it never counts as available.
const lastUndoable = (): MoveBatch | undefined => {
    for (let i = batches.length - 1; i >= 0; i--) {
        if (batches[i].entries.length > 0) return batches[i];
    }
    return undefined;
};

export const canUndo = (): boolean => lastUndoable() !== undefined;

export const undoLabel = (): string => {
    const batch = lastUndoable();
    if (!batch) return "Undo";
    const n = batch.entries.length;
    return `Undo move of ${n} file${n === 1 ? "" : "s"} to ${batch.folder}`;
};

// Dropped whenever the user switches folders: entries name media ids and paths
// belonging to the old folder's index.db, so offering them afterwards would at
// best do nothing and at worst move a file the user is no longer looking at.
export const clear = (): void => {
    batches = [];
};

// Puts one batch back, file by file. Two conditions make an entry unrestorable
// and both are skipped rather than forced:
//
//  - the file is no longer at `to`: something outside this app moved, renamed
//    or deleted it, so there is nothing here to move back and guessing where it
//    went would be worse than saying so.
//  - `from` is occupied again: a different file has taken the original name,
//    and overwriting it would destroy data to undo a move.
//
// The batch pops either way. A partially-undone batch left on the stack turns
// the next Ctrl+Z into a guess about what it will do; the caller reports the
// skips instead so the user can see exactly what stayed put.
export const undoLast = (onRestored: (entry: MoveEntry) => void): UndoOutcome | null => {
    const batch = lastUndoable();
    if (!batch) return null;

    batches = batches.filter((b) => b !== batch);

    const outcome: UndoOutcome = { restored: 0, skipped: [] };

    for (const entry of batch.entries) {
        const skip = (reason: string) => outcome.skipped.push({ ...entry, reason });

        if (!fs.existsSync(entry.to)) {
            skip("file is no longer where it was moved to");
            continue;
        }
        if (fs.existsSync(entry.from)) {
            skip("another file now occupies the original path");
            continue;
        }

        try {
            fs.renameSync(entry.to, entry.from);
        } catch (error) {
            // rename cannot cross volumes - same copy+delete fallback the
            // forward move uses in app.ts.
            if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
                skip((error as Error).message);
                continue;
            }
            try {
                fs.copyFileSync(entry.to, entry.from);
                fs.unlinkSync(entry.to);
            } catch (fallbackError) {
                skip((fallbackError as Error).message);
                continue;
            }
        }

        outcome.restored++;
        onRestored(entry);
    }

    return outcome;
};
