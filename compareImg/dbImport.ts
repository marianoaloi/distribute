import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import * as compareImgStore from "./HashStore";
import { meanAbsDiff, MEAN_DIFF_THRESHOLD } from "./duplicateFinder";

import type { Dialog, BrowserWindow } from "electron";
import type { StreamMediaItem } from "../types/domain";

export interface ImportMatch {
    localPath: string;
    actualIds: string[];
    exists: boolean;
}

export type CompareImportedDatabaseResult =
    | { error: string; matches?: undefined }
    | { matches: ImportMatch[]; error?: undefined };

// Compares another folder's exported index database (see HashStore's
// exportDatabase) against the live index, WITHOUT merging anything into it:
// the imported db is opened readonly and closed again, and matches are only
// reported back so the renderer can show them as transient "fake" items.
//
// Returns { error } when the file isn't usable (missing items table or a
// column layout different from the live schema — comparing across different
// schemas would silently mis-read rows), otherwise
// { matches: [{ localPath, actualIds }] } where localPath is the external
// file (verified to still exist on disk) and actualIds are the media ids in
// the current folder it visually duplicates.
export const compareImportedDatabase = (importedPath: string): CompareImportedDatabaseResult => {
    compareImgStore.ensureReady();

    let imported: Database.Database;
    try {
        imported = new Database(importedPath, { readonly: true, fileMustExist: true });
    } catch (error) {
        return { error: `Could not open the selected file as a database: ${(error as Error).message}` };
    }

    try {
        const importedCols = (imported.pragma("table_info(items)") as Array<{ name: string }>).map((c) => c.name);
        if (importedCols.length === 0) {
            return { error: "Selected file has no 'items' table — not an exported index database" };
        }
        const sorted = (cols: string[]) => [...cols].sort().join(",");
        if (sorted(importedCols) !== sorted(compareImgStore.columnNames())) {
            return { error: "Database structure differs from the actual index (different columns) — import ignored" };
        }

        const actualRows = compareImgStore.allBaseGreyRows();
        const actualPaths = new Set(actualRows.map((r) => r.localPath));
        const importedRows = imported
            .prepare(`
                SELECT media.localPath AS localPath, items.baseGrey AS baseGrey
                FROM media_item
                JOIN items ON items.id = media_item.itemId
                JOIN media ON media.id = media_item.mediaId
                WHERE items.baseGrey IS NOT NULL
            `)
            .all() as Array<{ localPath: string; baseGrey: Buffer }>;

        // Videos contribute one row per extracted frame sharing a localPath,
        // so cache the on-disk check and accumulate matches per file.
        const existsCache = new Map<string, boolean>();
        const stillExists = (p: string): boolean => {
            if (!existsCache.has(p)) existsCache.set(p, fs.existsSync(p));
            return existsCache.get(p) as boolean;
        };

        // Files missing from disk still participate: the match proves the
        // ACTUAL folder's item is duplicated elsewhere, which is what the
        // user decides on — the missing file just gets a placeholder tile.
        const matchesByPath = new Map<string, Set<string>>();
        for (const row of importedRows) {
            // Same physical file indexed in both databases is not a
            // cross-folder duplicate (e.g. re-importing this folder's own export).
            if (actualPaths.has(row.localPath)) continue;
            for (const actual of actualRows) {
                if (meanAbsDiff(row.baseGrey, actual.baseGrey) <= MEAN_DIFF_THRESHOLD) {
                    if (!matchesByPath.has(row.localPath)) matchesByPath.set(row.localPath, new Set());
                    (matchesByPath.get(row.localPath) as Set<string>).add(actual.mediaId);
                }
            }
        }

        return {
            matches: [...matchesByPath.entries()].map(([localPath, ids]) => ({
                localPath,
                actualIds: [...ids],
                exists: stillExists(localPath),
            })),
        };
    } finally {
        imported.close();
    }
};

// Inline SVG shown for an imported match whose file no longer exists on
// disk — a data: URI needs no file to load (toMediaUrl passes it through).
const MISSING_PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">' +
    '<rect width="200" height="200" fill="#2a2f3a"/>' +
    '<text x="100" y="92" fill="#e6a23c" font-size="16" text-anchor="middle" font-family="sans-serif">file not on disk</text>' +
    '<text x="100" y="116" fill="#8a8f99" font-size="12" text-anchor="middle" font-family="sans-serif">imported reference</text>' +
    '</svg>');

// Same shape transformDataStreaming produces, but for a file that is gone:
// rendered as an image tile backed by the placeholder above.
const missingFileItem = (localPath: string, id: string): StreamMediaItem => ({
    item: localPath,
    mime: "image/svg+xml",
    fileName: MISSING_PLACEHOLDER,
    filename: path.basename(localPath),
    size: 0,
    mtimeMs: 0,
    hasAudio: false,
    kind: "image",
    id,
    imported: true,
});

type TransformDataStreaming = (
    data: string[],
    folderOpened: string,
    onReadyGo: (items: StreamMediaItem[]) => void,
    onSendOneMedia: (item: StreamMediaItem) => void,
    onDone: () => void,
    extraFields?: Partial<StreamMediaItem>,
) => unknown;

export interface RunImportFlowDeps {
    dialog: Dialog;
    mainWindow: BrowserWindow;
    transformDataStreaming: TransformDataStreaming;
    hashFor: (input: string) => string;
}

// The whole ipc flow behind app.js's "importDatabase" handler, with the
// electron/util pieces injected so app.js stays a thin dispatcher (and this
// module stays loadable without electron). Reports through the
// "databaseImported" channel; on success also streams every matched external
// file as an { imported: true } fake item and finally sends the cross-folder
// groups via "duplicatesFound".
export const runImportFlow = async ({ dialog, mainWindow, transformDataStreaming, hashFor }: RunImportFlowDeps): Promise<void> => {
    const report = (payload: Record<string, unknown>) => mainWindow.webContents.send("databaseImported", payload);
    try {
        compareImgStore.ensureReady();
        if (compareImgStore.countItems() === 0) {
            report({ success: false, error: "No index for the actual folder — rebuild the index first" });
            return;
        }
        const picked = await dialog.showOpenDialog(mainWindow, {
            title: "Import another folder's exported database",
            filters: [{ name: "SQLite Database", extensions: ["db"] }],
            properties: ["openFile"],
        });
        if (picked.canceled || picked.filePaths.length === 0) {
            report({ success: false, canceled: true });
            return;
        }
        const compared = compareImportedDatabase(picked.filePaths[0]);
        if (compared.error !== undefined) {
            report({ success: false, error: compared.error });
            return;
        }
        if (compared.matches.length === 0) {
            report({ success: true, matched: 0 });
            return;
        }
        const onDisk = compared.matches.filter(m => m.exists);
        // Matches whose file has since disappeared can't go through the
        // thumbnail pipeline — they become inline placeholder tiles instead,
        // so the actual folder's duplicated item still shows in its group.
        compared.matches.filter(m => !m.exists).forEach(m =>
            mainWindow.webContents.send("addOneMedia", missingFileItem(m.localPath, hashFor(m.localPath))));
        // addOneMedia dedupes by id in the renderer, so re-importing is idempotent.
        await new Promise<void>((resolve) => transformDataStreaming(
            onDisk.map(m => m.localPath),
            "",
            (images) => images.forEach(img => mainWindow.webContents.send("addOneMedia", img)),
            (video) => mainWindow.webContents.send("addOneMedia", video),
            resolve,
            { imported: true }
        ));
        // Groups go out only after every fake item has been streamed, so the
        // duplicates grid never renders a group whose imported member is missing.
        mainWindow.webContents.send("duplicatesFound", compared.matches.map(m => [...m.actualIds, hashFor(m.localPath)]));
        report({ success: true, matched: compared.matches.length });
    } catch (error) {
        console.error("importDatabase failed", error);
        report({ success: false, error: (error as Error).message });
    }
};
