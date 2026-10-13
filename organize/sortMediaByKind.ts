import fs from "fs";
import path from "path";

import * as MediaStore from "../mediaDb/MediaStore";
import { moveSync } from "../fileOps/moveSync";

import type { Dialog, BrowserWindow } from "electron";
import type { MediaAwaitingSortRow, MediaKind } from "../types/domain";

// Sends media that was filed into a destination folder back beside its
// origin, sorted into a per-kind subfolder. A TypeScript port of
// scripts/sort_media_by_kind.py (FaceRecognition), with one deliberate
// change: the Python script had to hunt for each file by name with a
// recursive rglob over the search root, because it had no record of where the
// file had gone. media.futurePosition is exactly that record, so the source is
// read straight from it - no filesystem search, no ambiguity when two folders
// hold a file of the same name.
//
// The destination rule is the script's, unchanged:
//     dirname(localPath) / kind          when the media has no audio
//     dirname(localPath) / kind_audio    when it does

export const kindFolderName = (kind: MediaKind, hasAudio: boolean): string =>
    hasAudio ? `${kind}_audio` : kind;

/** Same path, accounting for separators and Windows' case-insensitivity. */
const samePath = (a: string, b: string): boolean =>
    path.relative(path.resolve(a), path.resolve(b)) === "";

// True when `candidate` sits inside `root`. path.relative handles both
// separator normalisation and (on win32) case-insensitive drive/segment
// comparison, and the "" case is excluded so the root itself is not "inside"
// itself. The !isAbsolute guard rejects a different drive entirely.
const isInside = (root: string, candidate: string): boolean => {
    const rel = path.relative(path.resolve(root), path.resolve(candidate));
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

export interface SortMove {
    mediaId: string;
    from: string;
    to: string;
    targetDir: string;
}

export interface SortPlan {
    moves: SortMove[];
    /** Already sitting in the right kind folder - nothing to do. */
    alreadyInPlace: number;
    /** futurePosition points at a file that is no longer there. */
    missing: string[];
    /** A different file already occupies the destination name. */
    blocked: Array<{ from: string; to: string }>;
}

// Works out what would move, without touching anything. Split from applyPlan
// so the user can be shown a real count before a bulk move rather than being
// asked to approve a number the app has not actually verified.
export const buildPlan = (searchRoot: string, rows: MediaAwaitingSortRow[]): SortPlan => {
    const plan: SortPlan = { moves: [], alreadyInPlace: 0, missing: [], blocked: [] };

    for (const row of rows) {
        // Only the folder the user picked. Everything filed elsewhere stays
        // where it is - this is a per-folder tidy-up, not a library-wide one.
        if (!isInside(searchRoot, row.futurePosition)) continue;

        const kindFolder = kindFolderName(row.kind, row.hasAudio !== 0);
        const dirNameOfFile = path.dirname(row.localPath);
        let targetDir: string;
        if (path.basename(dirNameOfFile) !== kindFolder) {
            targetDir = path.join(dirNameOfFile, kindFolder);
        } else {
            targetDir = dirNameOfFile;
        }
        const to = path.join(targetDir, row.filename);

        if (!fs.existsSync(row.futurePosition)) {
            plan.missing.push(row.futurePosition);
            continue;
        }
        if (samePath(row.futurePosition, to)) {
            plan.alreadyInPlace++;
            continue;
        }
        // Never overwrite: a same-named file already at the destination is a
        // different file, and clobbering it to tidy up would destroy data.
        if (fs.existsSync(to)) {
            plan.blocked.push({ from: row.futurePosition, to });
            continue;
        }

        plan.moves.push({ mediaId: row.id, from: row.futurePosition, to, targetDir });
    }

    return plan;
};

export interface SortResult {
    moved: number;
    alreadyInPlace: number;
    missing: number;
    blocked: number;
    failed: Array<{ from: string; reason: string }>;
}

// What the renderer needs to re-point a tile at a relocated media: the id
// changes with the path (see MediaStore.relocateMedia).
export interface Relocated {
    id: string;
    newId: string;
    path: string;
}

// Carries out the plan. Each successful move makes the new location the
// media's home (localPath, futurePosition cleared) and is reported through
// onRelocated. Not recorded for undo: the media is no longer "filed away", so
// there is no origin left to send it back to.
export const applyPlan = (plan: SortPlan, onRelocated: (moved: Relocated) => void): SortResult => {
    const result: SortResult = {
        moved: 0,
        alreadyInPlace: plan.alreadyInPlace,
        missing: plan.missing.length,
        blocked: plan.blocked.length,
        failed: [],
    };

    for (const move of plan.moves) {
        // Re-checked here rather than trusted from plan time: building the plan
        // and approving it are separated by a dialog the user can sit on.
        if (!fs.existsSync(move.from)) {
            result.missing++;
            continue;
        }
        if (fs.existsSync(move.to)) {
            result.blocked++;
            continue;
        }

        try {
            fs.mkdirSync(move.targetDir, { recursive: true });
            moveSync(move.from, move.to);
        } catch (error) {
            result.failed.push({ from: move.from, reason: (error as Error).message });
            continue;
        }

        try {
            const newId = MediaStore.relocateMedia(move.mediaId, move.to);
            if (newId) {
                onRelocated({ id: move.mediaId, newId, path: move.to });
            } else {
                // A stale row already holds the new id/path. Keep the record
                // truthful about where the file is, and leave the tile hidden.
                console.error("Sorted", move.from, "but a row already exists for", move.to, "- recording it as futurePosition instead");
                MediaStore.setFuturePosition(move.mediaId, move.to, null);
            }
        } catch (error) {
            console.error("Sorted", move.from, "but could not relocate its row -", error);
            // The transaction rolled back, so the row still names the old
            // futurePosition, which is now empty. Point it at the file.
            try {
                MediaStore.setFuturePosition(move.mediaId, move.to, null);
            } catch (fallbackError) {
                console.error("Could not record the new position of", move.to, "either -", fallbackError);
            }
        }

        result.moved++;
    }

    return result;
};

export interface RunSortFlowDeps {
    dialog: Dialog;
    mainWindow: BrowserWindow;
    /** Folder the picker opens on - the currently loaded folder, when there is one. */
    defaultPath?: string;
}

const describe = (plan: SortPlan): string => {
    const lines = [`${plan.moves.length} file(s) will be moved.`];
    if (plan.alreadyInPlace > 0) lines.push(`${plan.alreadyInPlace} already in the right folder.`);
    if (plan.missing.length > 0) lines.push(`${plan.missing.length} no longer at the recorded location.`);
    if (plan.blocked.length > 0) lines.push(`${plan.blocked.length} blocked by a same-named file at the destination.`);
    return lines.join("\n");
};

// The whole ipc flow behind app.ts's "sortMediaByKind" handler, with the
// electron pieces injected so app.ts stays a thin dispatcher (and this module
// stays loadable without electron). Reports through "sortByKindFinished".
export const runSortFlow = async ({ dialog, mainWindow, defaultPath }: RunSortFlowDeps): Promise<void> => {
    const report = (payload: Record<string, unknown>) => mainWindow.webContents.send("sortByKindFinished", payload);

    try {
        MediaStore.ensureReady();

        const picked = await dialog.showOpenDialog(mainWindow, {
            title: "Choose the folder holding the media to send back",
            properties: ["openDirectory"],
            ...(defaultPath ? { defaultPath } : {}),
        });
        if (picked.canceled || picked.filePaths.length === 0) {
            report({ success: false, canceled: true });
            return;
        }
        const searchRoot = picked.filePaths[0];

        const rows = MediaStore.findMediaWithFuturePosition();
        if (rows.length === 0) {
            report({ success: false, error: "No media has been moved into a folder yet — nothing to send back" });
            return;
        }

        const plan = buildPlan(searchRoot, rows);
        if (plan.moves.length === 0) {
            report({
                success: true,
                moved: 0,
                alreadyInPlace: plan.alreadyInPlace,
                missing: plan.missing.length,
                blocked: plan.blocked.length,
                failed: [],
            });
            return;
        }

        // A bulk move is worth confirming with a real count first - the Python
        // script defaulted to a dry run for the same reason. There is no undo for
        // this move, so this is the only chance to catch the wrong folder.
        const confirmed = await dialog.showMessageBox(mainWindow, {
            type: "question",
            buttons: ["Move", "Cancel"],
            defaultId: 0,
            cancelId: 1,
            title: "Send media back into kind folders",
            message: `Send ${plan.moves.length} file(s) back beside their original folder, sorted by kind?`,
            detail: describe(plan),
        });
        if (confirmed.response !== 0) {
            report({ success: false, canceled: true });
            return;
        }

        // Tell the renderer each tile is back, under its new id and path.
        const result = applyPlan(plan, (moved) => mainWindow.webContents.send("fileUnmoved", moved));

        report({ success: true, ...result });
    } catch (error) {
        console.error("sortMediaByKind failed", error);
        report({ success: false, error: (error as Error).message });
    }
};
