import fs from "fs";

// Moves one file, falling back to copy+delete when rename cannot do it.
//
// fs.rename fails with EXDEV across volumes, which is the normal case here:
// the folders a user files media into can sit on a different drive from the
// source. Shared by every synchronous mover (undo/UndoStack.ts,
// organize/sortMediaByKind.ts) so the fallback exists in exactly one place -
// app.ts's moveFile keeps its own copy only because it is callback-async.
//
// Throws on failure; callers decide whether that is a skip or an error.
export const moveSync = (from: string, to: string): void => {
    try {
        fs.renameSync(from, to);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
        fs.copyFileSync(from, to);
        fs.unlinkSync(from);
    }
};
