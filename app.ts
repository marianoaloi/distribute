// First import, ahead of everything else: patches console.log/console.error
// (electron-log's documented console takeover) so every module's existing
// plain console calls - mediaIndexer.ts, videoFrames.ts, computePool.ts,
// this file, etc. - land in tmp/logs/app.log from the moment the process
// starts, not just from wherever this happened to be required.
import { redirectToActiveFolder } from "./logging/AppLog";

import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, IpcMainEvent, MenuItemConstructorOptions, OpenDialogOptions } from "electron";
import path from "path";
import fs from "fs";
import installExtension, { REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS } from "electron-devtools-installer";

const isDev = process.env.NODE_ENV === "development";
const isMac = process.platform === 'darwin';
protocol.registerSchemesAsPrivileged([
    { scheme: 'local-media', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } }
]);



import os from 'os';
import * as util from "./util";
import { setActiveFolder } from "./DirectorioCache";
import * as duplicateFinder from "./compareImg/duplicateFinder";
import * as compareImgStore from "./compareImg/HashStore";
import * as mediaIndexer from "./compareImg/mediaIndexer";
import * as dbImport from "./compareImg/dbImport";
import { hashFor } from "./thumbnails/cache";
import * as onnxDetector from "./objectDetection/onnxDetector";
import * as MediaStore from "./mediaDb/MediaStore";
import { backfillContentMd5 } from "./mediaDb/backfill";
import * as pipelineRun from "./pipeline/PipelineRun";
import * as ThumbnailService from "./thumbnails/ThumbnailService";
import { framePathFor, frameSetForMedia } from "./compareImg/videoFrames";
import type { DetectionBox, DetectMediaRef, DetectObjectsPayload, StreamMediaItem } from "./types/domain";
import { processMediaToDetections } from "./objectDetection/processImages";

const transformDataStreaming = util.transformDataStreaming;

interface MoveFileEntry {
    id: string;
    path: string;
    checked: boolean;
    imported?: boolean;
}

interface ProcessPayload {
    folder: string;
    onlyCopy: boolean;
    data: MoveFileEntry[];
}



interface SaveDetectionClassesPayload {
    classes?: string;
}

interface SaveDetectionSizePayload {
    size?: number | string | null;
}

interface MaloiFile {
    onnx?: string;
    classes?: string;
    // Per-model override for onnxDetector's letterbox/tensor input
    // resolution (objectDetection/onnxDetector.js's setModelSize) - fixes
    // onnxruntime's native "ReshapeHelper ... input_shape_size ==
    // requested_shape_size was false" crash for models whose exported graph
    // bakes a Reshape op sized for a specific input resolution other than
    // the 640 default.
    reshape?: number;
}

const splitClassNames = (raw: string): string[] =>
    String(raw).split(",").map((s) => s.trim()).filter((s) => s.length > 0);

// Shared guard for every long-running entry point (loadRecursive/
// loadSuperRecursive, rebuildIndex, detectObjects, exportDatabase,
// importDatabase, findIndexDuplicates): refuses to start a second one while
// pipelineRun already has one in flight, rather than letting two compete for
// the same per-folder index.db/onnxDetector state. Reports back through a
// dedicated channel (not an alert/dialog) so the renderer decides how to
// show it - see pipelineRejected in redux/slices/pipeline.
const rejectIfBusy = (): boolean => {
    if (!pipelineRun.isRunning()) return false;
    mainWindow!.webContents.send("pipelineRejected", {
        message: `Still running "${pipelineRun.currentKind()}" - wait for it to finish before starting another long operation.`,
    });
    return true;
};

const menuTemplate = (): MenuItemConstructorOptions[] => [
    {
        label: 'File',
        submenu: [
            { label: 'Load recursive', enabled: !pipelineRun.isRunning(), click: () => { if (!rejectIfBusy()) loadRecursive(); } },
            { label: 'Load super recursive', enabled: !pipelineRun.isRunning(), click: loadSuperRecursive },
        ]
    },
    {
        label: 'View',
        submenu: [
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
        ]
    },
    {
        label: 'Work',
        submenu: [
            { label: 'Load buttons by folders', click: loadFolders },
            {
                label: 'Zoom In',
                click: () => zoomImg(+1),
                accelerator: "numadd"
            },
            {
                label: 'Zoom Out',
                click: () => zoomImg(-1),
                accelerator: "numsub"
            },
            { label: 'Clean', click: cleanGrid },
        ]
    },
    {
        // Sorting itself lives in redux now (see media.reduce.ts orderByName/
        // orderBySize/orderByFolder) - these just tell the renderer which one
        // to apply, Electron doesn't track or reflect the active sort anymore.
        label: 'Order',
        submenu: [
            { label: "Sort by Name", click: sortByName },
            { label: "Sort by Size", click: sortBySize },
            { label: "Sort by Size Inverted", click: sortBySizeInverted },
            { label: "Sort by Folder", click: sortByFolder },
        ]
    },

];

const updateMenu = (): void => {
    try {
        const menu = Menu.buildFromTemplate(menuTemplate());
        Menu.setApplicationMenu(menu);
    } catch (error) {
        console.error("Error setting application menu", error);
    }
};

// Wires pipelineRun's stage/ETA snapshots and end-of-run result straight to
// the renderer (pipelineProgress/pipelineFinished - see redux/slices/pipeline)
// and re-enables the File menu's recursive-load items once a run ends,
// whether it finished, failed, or was cancelled.
pipelineRun.configure({
    onProgress: (snapshot) => { if (mainWindow) mainWindow.webContents.send("pipelineProgress", snapshot); },
    onDone: (result) => {
        if (mainWindow) mainWindow.webContents.send("pipelineFinished", result);
        updateMenu();
    },
});

let mainWindow: BrowserWindow | null;
let fileGlobal: string | undefined;
function createWindow(): void {
    try {
        ThumbnailService.ensureCacheDir();
    } catch (error) {
        console.error("Error creating tmp folder", error);
    }
    mainWindow = new BrowserWindow({
        // width: 1200,
        // height: 600,
        // __dirname is electron-dist/ (this file's compiled location) - the
        // CRA renderer build stays at the repo/package root as a sibling
        // directory, both in dev and inside the packaged app.asar (see
        // package.json build.files), so it's reached via "..".
        icon: path.join(__dirname, "..", "build", "logo512.png"),
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            spellcheck: true,
            preload: path.join(__dirname, 'preload.js'),
        },
        // The original also passed a top-level `options: { fullscreen: true }`
        // key, which isn't part of BrowserWindowConstructorOptions - Electron
        // silently ignored it (no-op), so it's dropped here rather than kept
        // as a now-type-erroring dead field.
    });

    const startURL = isDev
        ? 'http://localhost:7845'
        : `file://${path.join(__dirname, "..", "build", "index.html")}`;

    try {
        mainWindow.loadURL(startURL);
    } catch (error) {
        console.error(`Error loading URL: ${error}
            IsDev: ${isDev}
            Start URL: ${startURL}`);
    }

    if (isDev) {
        mainWindow.webContents.openDevTools();

    }

    mainWindow.on("closed", function () {
        mainWindow = null;
    });



    updateMenu();


    try {
        if (process.argv[2]) {
            console.log("File receive folder", process.argv);
            fileGlobal = process.argv[2];
        } else if (process.argv[0].includes("getimage")) {
            fileGlobal = process.argv[1];
        }
    } catch (error) {
        console.error("Error processing command line arguments", error);
    }


    mainWindow.focus();

}



app.on("ready", () => {
    protocol.registerFileProtocol('local-media', (request, callback) => {
        const filePath = decodeURIComponent(request.url.replace('local-media://', ''));
        callback({ path: filePath });
    });
    createWindow();


});

app.on("window-all-closed", function () {
    if (isMac) app.quit();
    else process.exit(0);
});

app.on('before-quit', () => {
    if (mainWindow) {
        mainWindow.removeAllListeners('close');
        mainWindow.close();
    }
});
/********************************************** */

app.on("activate", function () {
    if (mainWindow === null) createWindow();
});

ipcMain.on("open", () => {
    const options: OpenDialogOptions = {
        properties: ["openDirectory", 'promptToCreate'],
        title: "Open folder to choice images",
    };
    if (fileGlobal) options.defaultPath = fileGlobal;
    dialog.showOpenDialog(options).then(file => {
        if (!file.canceled) {
            fileGlobal = file.filePaths[0];
            setActiveFolder(fileGlobal);
            redirectToActiveFolder();
            compareImgStore.closeConnection();
        }
        openfile();
    }).catch(err => {
        console.error(err);
    })
        .finally();

});

ipcMain.on("process", async (event: IpcMainEvent, data: ProcessPayload) => {
    if (data) {
        moveFile(true, data.folder, data.onlyCopy, data.data);
    }
});

// onProgress passthrough lets runSuperExecutionPipeline feed this stage's
// real per-row progress into pipelineRun's "duplicates" stage - unset (the
// common case: the standalone "scan for duplicates" button) it's just the
// plain scan with no extra reporting.
const findIndexDuplicates = async (onProgress?: (comparedRows: number, totalRows: number) => void): Promise<void> => {
    try {
        const groups = await duplicateFinder.findIndexDuplicates(onProgress);
        mainWindow!.webContents.send("duplicatesFound", groups);
    } catch (error) {
        console.error("findIndexDuplicates failed", error);
        mainWindow!.webContents.send("duplicatesFound", []);
    }
};
ipcMain.on("findIndexDuplicates", () => { if (!rejectIfBusy()) findIndexDuplicates(); });

// Reads back whatever the last findIndexDuplicates scan persisted
// (compareImg/HashStore.js's items_duplicated table) instead of re-running
// the slow O(n^2) pixel comparison - lets the duplicates view show its last
// result as soon as it opens.
const getDuplicateGroups = (): void => {
    try {
        compareImgStore.ensureReady();
        const groups = compareImgStore.getDuplicateGroups();
        mainWindow!.webContents.send("duplicatesFound", groups);
    } catch (error) {
        console.error("getDuplicateGroups failed", error);
        mainWindow!.webContents.send("duplicatesFound", []);
    }
};
ipcMain.on("getDuplicateGroups", getDuplicateGroups);

// Runs ONNX object detection (objectDetection/onnxDetector.js) over the
// media the renderer currently has loaded, one at a time, streaming each
// result back as it finishes rather than waiting for the whole batch (same
// streaming shape as indexRebuildProgress/addOneMedia).
// Set by the renderer's stop button: detection runs one media at a time, so
// the loop below just stops picking up the next item. Already-computed boxes
// stay valid — stopping only cuts the run short (e.g. the model is clearly
// not good enough to be worth finishing the whole library).
let detectionStopRequested = false;
ipcMain.on("stopDetection", () => { detectionStopRequested = true; });

// Lets the user pick either a bare .onnx model file (old fixed ./xcxv/best.onnx
// path replacement) or a .maloi file - a small JSON sidecar of the shape
// { "onnx": "<path>", "classes": "a,b,c" } that sets the model *and* its class
// list in one pick, so switching models doesn't also mean re-typing classes.
// Sends the chosen path (or the still-unset current one, if canceled) back so
// the renderer can reflect it and gate the run button.
// Shared by the standalone "chooseOnnxModel" IPC handler below and by
// loadSuperRecursive (which needs a model picked BEFORE it kicks off a
// recursive scan, since detectObjects - the last stage of that chain -
// refuses to run without one). Returns whether a model is available once the
// dialog closes: freshly chosen, or the previously-configured one if the
// user cancels (same "still-unset current one" fallback the standalone
// picker already had).
const chooseOnnxModelDialog = async (): Promise<boolean> => {
    const options: OpenDialogOptions = {
        properties: ["openFile"],
        title: "Choose ONNX model (or .maloi model+classes file) for object detection",
        filters: [
            { name: "Model files", extensions: ["onnx", "maloi"] },
            { name: "ONNX model", extensions: ["onnx"] },
            { name: "Maloi model set", extensions: ["maloi"] },
        ],
    };
    try {
        const file = await dialog.showOpenDialog(options);
        if (!file.canceled && file.filePaths[0]) {
            const chosenPath = file.filePaths[0];
            MediaStore.ensureReady();
            if (path.extname(chosenPath).toLowerCase() === ".maloi") {
                const maloi: MaloiFile = JSON.parse(fs.readFileSync(chosenPath, "utf8"));
                const onnxPath = path.resolve(path.dirname(chosenPath), maloi.onnx || "");
                onnxDetector.setModelPath(onnxPath);
                MediaStore.getOrCreateModelPath(onnxPath);
                const names = splitClassNames(maloi.classes || "");
                MediaStore.saveDetectionClasses(names);
                onnxDetector.setClassNames(names);
                mainWindow!.webContents.send("detectionClassesLoaded", { names });
                // Always set (even to null/absent) rather than only when
                // present - otherwise a .maloi with no "reshape" field would
                // silently inherit whatever override an earlier .maloi pick
                // left behind, for a model it has nothing to do with.
                onnxDetector.setModelSize(typeof maloi.reshape === "number" ? maloi.reshape : null);
            } else {
                onnxDetector.setModelPath(chosenPath);
                MediaStore.getOrCreateModelPath(chosenPath);
                // A bare .onnx carries no reshape hint - clear any override
                // left by a previously-picked .maloi so it doesn't get
                // reused against an unrelated model (risking the exact
                // native crash the override exists to avoid).
                onnxDetector.setModelSize(null);
            }
        }
        mainWindow!.webContents.send("onnxModelChosen", { path: onnxDetector.getModelPath(), size: onnxDetector.getSize() });
    } catch (err) {
        console.error("chooseOnnxModel failed", err);
    }
    return onnxDetector.isAvailable();
};

ipcMain.on("chooseOnnxModel", () => { if (!rejectIfBusy()) chooseOnnxModelDialog(); });

// Shared by the standalone "detectObjects" IPC handler below and by
// loadSuperRecursive's chain - pulls medias/items straight from MediaStore
// (see objectDetection/processImages.js), so it needs nothing passed in from
// the renderer either way.
const runDetectObjects = async (): Promise<void> => {
    // Gate: refuse to start (rather than silently no-op or error mid-run)
    // unless both a model and at least one class name are configured - the
    // renderer pre-checks the same two conditions and shows an alert, this
    // is the authoritative backend guard.
    if (!onnxDetector.isAvailable()) {
        mainWindow!.webContents.send("detectionsComplete", { error: "no-model" });
        return;
    }
    const classNames = onnxDetector.getClassNames();
    if (classNames.length === 0) {
        mainWindow!.webContents.send("detectionsComplete", { error: "no-classes" });
        return;
    }

    detectionStopRequested = false;

    // Forwards progress into pipelineRun's "detect" stage only when this run
    // is part of the loadSuperRecursive chain - a manual Play-button run
    // already has its own progress bar (objectDetectionGrid.tsx, driven by
    // the "detectionProgress" event processMediaToDetections always sends).
    const onProgress = pipelineRun.isRunning()
        ? (processed: number, total: number) => pipelineRun.updateStage(processed, total)
        : undefined;

    await processMediaToDetections(mainWindow, onnxDetector, classNames, detectionStopRequested, onProgress).catch(error => {
        console.error("processMediaToDetections failed", error);
    });

    mainWindow!.webContents.send("detectionsComplete", detectionStopRequested ? { stopped: true } : {});
};

ipcMain.on("detectObjects", async (event: IpcMainEvent, data: DetectObjectsPayload) => {
    if (rejectIfBusy()) return;
    await runDetectObjects();
});

// Persists the user-typed comma-separated class list (mediaDb's
// detection_class table, per-folder like the rest of index.db) and pushes it
// into onnxDetector so subsequent detections use the real names instead of
// "class N". The main process owns the split - the renderer always sends the
// raw string. detectionClassesLoaded is the reply to both this and
// loadDetectionClasses, so the UI can never drift from what got persisted.
ipcMain.on("saveDetectionClasses", (event: IpcMainEvent, data: SaveDetectionClassesPayload) => {
    try {
        const names = splitClassNames((data && data.classes) || "");
        MediaStore.ensureReady();
        MediaStore.saveDetectionClasses(names);
        onnxDetector.setClassNames(names);
        mainWindow!.webContents.send("detectionClassesLoaded", { names });
    } catch (error) {
        console.error("saveDetectionClasses failed", error);
        mainWindow!.webContents.send("detectionClassesLoaded", { names: [], error: (error as Error).message });
    }
});

ipcMain.on("loadDetectionClasses", () => {
    try {
        MediaStore.ensureReady();
        const names = MediaStore.getDetectionClasses();
        onnxDetector.setClassNames(names);
        mainWindow!.webContents.send("detectionClassesLoaded", { names });
    } catch (error) {
        console.error("loadDetectionClasses failed", error);
        mainWindow!.webContents.send("detectionClassesLoaded", { names: [], error: (error as Error).message });
    }
});

// User-facing override for onnxDetector's letterbox/tensor input resolution
// (objectDetection/onnxDetector.js's setUserSize) - the frontend's "detection
// size" dialog. Not persisted to index.db (mirrors modelPath, which also
// resets each app session) - session-only is enough for a value that's
// really about working around one specific ONNX export's quirks, and a
// .maloi's "reshape" field (see chooseOnnxModelDialog) is the durable,
// per-model way to set it anyway. The main process re-validates rather than
// trusting the renderer's own check - same defense-in-depth as
// saveDetectionClasses's split/trim.
ipcMain.on("saveDetectionSize", (event: IpcMainEvent, data: SaveDetectionSizePayload) => {
    try {
        const raw = data && data.size;
        const parsed = (raw === null || raw === undefined || raw === "") ? null : Number(raw);
        const size = (parsed !== null && Number.isFinite(parsed) && parsed > 0) ? Math.round(parsed) : null;
        onnxDetector.setUserSize(size);
        mainWindow!.webContents.send("detectionSizeLoaded", { size: onnxDetector.getSize() });
    } catch (error) {
        console.error("saveDetectionSize failed", error);
    }
});

// Lets the frontend prefill its "detection size" dialog with whatever's
// currently in effect (the .maloi override if one's active, otherwise the
// user-set value, otherwise the 640 default - see onnxDetector.getSize)
// instead of guessing or always showing the hardcoded default.
ipcMain.on("getDetectionSize", () => {
    mainWindow!.webContents.send("detectionSizeLoaded", { size: onnxDetector.getSize() });
});

// Hydrates every persisted detection for the current folder into the renderer
// in one message, so the grid's class filter works on a freshly opened folder
// without the user having to press Play again. index.db is per-folder, so no
// id list is needed - the whole item_detection table (joined through
// media_item) is the current media. boxes (for the detection grid's overlay)
// come from each media's single display item; classes (for classFilter/
// gridImg's filter) are the union across every item linked to that media -
// see MediaStore.getAllDisplayDetections/getDetectionClassesByMedia.
ipcMain.on("loadDetections", () => {
    try {
        MediaStore.ensureReady();
        const boxRows = MediaStore.getAllDisplayDetections();
        const boxesById = new Map<string, DetectionBox[]>();
        for (const row of boxRows) {
            const { mediaId, ...box } = row;
            if (!boxesById.has(mediaId)) boxesById.set(mediaId, []);
            (boxesById.get(mediaId) as DetectionBox[]).push(box);
        }

        const classRows = MediaStore.getDetectionClassesByMedia();
        const classesById = new Map<string, string[]>();
        for (const row of classRows) {
            if (!classesById.has(row.mediaId)) classesById.set(row.mediaId, []);
            (classesById.get(row.mediaId) as string[]).push(row.className);
        }

        const mediaIds = new Set([...boxesById.keys(), ...classesById.keys()]);
        const items = [...mediaIds].map((id) => ({
            id,
            boxes: boxesById.get(id) || [],
            classes: classesById.get(id) || [],
        }));
        mainWindow!.webContents.send("detectionsLoaded", { items });
    } catch (error) {
        console.error("loadDetections failed", error);
        mainWindow!.webContents.send("detectionsLoaded", { items: [], error: (error as Error).message });
    }
});

// Frame paths for the duplicates grid's 4-frame collage thumbnail - only for
// video/GIF media whose frames were already extracted (compareImg's
// duplicate-finder indexing); never spawns ffmpeg, so entries with nothing
// cached are simply omitted and the renderer falls back to a plain thumbnail.
ipcMain.on("getMediaFrames", (event: IpcMainEvent, data: { medias?: DetectMediaRef[] }) => {
    try {
        const medias = (data && data.medias) || [];
        const mediaState = MediaStore.findMediaByIds(medias.map((media) => media.id));
        const items = medias
            .map((media) => {
                const state = mediaState.get(media.id);
                if (!state) return null;
                const frames = frameSetForMedia(state.localPath).map((f) => f.path);
                return frames.length > 0 ? { id: media.id, frames } : null;
            })
            .filter((item): item is { id: string; frames: string[] } => item !== null);
        mainWindow!.webContents.send("mediaFramesFound", { items });
    } catch (error) {
        console.error("getMediaFrames failed", error);
        mainWindow!.webContents.send("mediaFramesFound", { items: [], error: (error as Error).message });
    }
});

// Wipes the (possibly corrupted) compareImg sqlite index and re-indexes the
// media the renderer already has loaded in redux, so the user doesn't need
// to re-open/re-scan the folder to recover from a corrupted index.db.
const buildIndex = async (): Promise<void> => {
    try {
        const medias = MediaStore.findAllMediaThatExists() || [];
        mainWindow!.webContents.send("indexRebuildProgress", { processed: 0, total: medias.length });
        if (pipelineRun.isRunning()) pipelineRun.updateStage(0, medias.length);
        await mediaIndexer.indexMediaBackground(medias.map(m => ({
            item: m.localPath,
            mime: m.mime,
            kind: m.kind,
            contentMd5: m.contentMd5,
            id: m.id,
        })), (processed, total) => {
            mainWindow!.webContents.send("indexRebuildProgress", { processed, total });
            if (pipelineRun.isRunning()) pipelineRun.updateStage(processed, total);
        });
        mainWindow!.webContents.send("indexRebuilt", { success: true, count: medias.length });
    } catch (error) {
        console.error("rebuildIndex failed", error);
        mainWindow!.webContents.send("indexRebuilt", { success: false, error: (error as Error).message });
    }
}
const rebuildIndex = async (): Promise<void> => {
    await buildIndex();
    await findIndexDuplicates();
};

ipcMain.on("rebuildIndex", () => { if (!rejectIfBusy()) rebuildIndex(); });

// Set by loadSuperRecursive right before it opens the recursive-folder
// dialog; consumed by notifyMediaLoadComplete once that scan actually
// finishes, to chain into buildIndex+detectObjects with no further user
// input. A plain "Load recursive" (menu item or the duplicates view's
// "open recursively" button) never sets this, so it stays a no-op for them.
let superExecutionInProgress = false;

// pipelineRun's stage list for the loadSuperRecursive chain - order matches
// the awaits in runSuperExecutionPipeline below. "scan" itself has no
// tracked progress (the folder walk's file count isn't known upfront, and
// it's normally the fastest part of the chain) - it exists here only so the
// overall-ETA fraction (stageIndex/stageCount) accounts for it once "hash"
// starts.
const SUPER_STAGES: pipelineRun.StageDef[] = [
    { key: "scan", label: "Scanning folder" },
    { key: "hash", label: "Hashing file content" },
    { key: "index", label: "Building comparison index" },
    { key: "detect", label: "Detecting objects" },
    { key: "duplicates", label: "Finding visual duplicates" },
];

// Runs after a recursive scan finishes: hashes any not-yet-hashed content
// (see backfillContentMd5's doc below), then the same pair "Rebuild index"
// already runs (buildIndex + findIndexDuplicates), then detectObjects - all
// reading their media/items straight from MediaStore/HashStore (see
// buildIndex and runDetectObjects above), so nothing needs passing through
// from the scan itself. Each stage still streams its own legacy progress
// event exactly like it does when triggered individually (indexRebuildProgress,
// detectionProgress, ...) AND, via pipelineRun, a unified stage/overall
// progress+ETA - see pipelineProgress in redux/slices/pipeline.
const runSuperExecutionPipeline = async (): Promise<void> => {
    try {
        // backfillContentMd5 is normally fire-and-forget (see util.js's
        // transformDataStreaming) so a plain folder open stays fast. But
        // buildIndex's indexMediaBackground silently skips any media whose
        // contentMd5 isn't set yet (mediaIndexer.js's indexImage/indexVideo),
        // and on a freshly-scanned folder every row is still contentMd5-NULL
        // at this point - without waiting here, buildIndex would run against
        // a fully-null batch and never populate `items` for this scan at
        // all, with nothing else left to retry it later. This chain is the
        // one place where waiting for the hash pass first is worth the
        // extra time.
        pipelineRun.startStage("hash");
        await backfillContentMd5((processed, total) => pipelineRun.updateStage(processed, total));

        pipelineRun.startStage("index");
        await buildIndex();

        pipelineRun.startStage("detect");
        await runDetectObjects();

        pipelineRun.startStage("duplicates");
        await findIndexDuplicates((processed, total) => pipelineRun.updateStage(processed, total));

        pipelineRun.finish();
    } catch (error) {
        console.error("super execution pipeline failed", error);
        pipelineRun.fail((error as Error).message);
    }
};

// Exports a consistent snapshot of the compareImg sqlite index so it can be
// carried to another machine/folder and later imported for cross-library
// duplicate comparison (the import/compare side is a follow-up feature).
ipcMain.on("exportDatabase", async () => {
    if (rejectIfBusy()) return;
    const options = {
        title: "Export duplicate-detection database",
        defaultPath: path.join(app.getPath("documents"), `index-export-${Date.now()}.db`),
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
    };
    try {
        const result = await dialog.showSaveDialog(mainWindow!, options);
        if (result.canceled || !result.filePath) {
            mainWindow!.webContents.send("databaseExported", { success: false, canceled: true });
            return;
        }
        await compareImgStore.exportDatabase(result.filePath);
        mainWindow!.webContents.send("databaseExported", { success: true, path: result.filePath });
    } catch (error) {
        console.error("exportDatabase failed", error);
        mainWindow!.webContents.send("databaseExported", { success: false, error: (error as Error).message });
    }
});

// Compares another folder's exported index against the live one (readonly —
// nothing is merged into index.db) and streams each matched external file to
// the renderer as a transient "imported" fake item, so the duplicates page
// can show cross-folder groups and the user can decide what to move.
// Full flow lives in compareImg/dbImport.js.
ipcMain.on("importDatabase", () => {
    if (rejectIfBusy()) return;
    dbImport.runImportFlow({ dialog, mainWindow: mainWindow!, transformDataStreaming, hashFor });
});

ipcMain.on("verifyOpen", async () => {
    if (process.env.FixFiles && fs.existsSync(process.env.FixFiles)) {
        fs.readFile(process.env.FixFiles, 'utf8', (err, data) => {
            let files: unknown = data.split("|").filter(filepath => fs.existsSync(filepath));
            // util.js has never exported transformFixedData (only
            // transformDataStreaming) - this FixFiles-only debug path already
            // threw at runtime before this conversion. Left as-is rather than
            // silently inventing a fix that wasn't asked for; the cast below
            // only keeps this pre-existing bug compiling instead of masking it.
            files = (util as unknown as { transformFixedData: (files: string[]) => unknown }).transformFixedData(files as string[]);

            mainWindow!.webContents.send("directoryOpen", files);
        });
    } else
        if (fileGlobal) {
            openfile();
        }
});

// Reports whether a single media's file operation actually finished on
// disk, so the renderer can mark it moved/deleted only once that's true
// instead of assuming success the moment the button was clicked (a failed
// move used to silently vanish the item from the grid while the file stayed
// put in the source folder).
const reportFileProcessed = (media: MoveFileEntry, onlyCopy: boolean, error?: NodeJS.ErrnoException | Error | null): void => {
    if (error) console.error(onlyCopy ? "Copy failed for" : "Move failed for", media.path, "-", error);
    mainWindow!.webContents.send("fileProcessed", {
        id: media.id,
        onlyCopy,
        success: !error,
        error: error ? error.message : undefined,
    });
};

const moveFile = (bol: boolean, dest: string, onlyCopy: boolean, data: MoveFileEntry[]): void => {
    if (process.env.FixFiles) {
        console.log("##MOVEFILE", dest, data.filter(f => f.checked === bol).map(f => f.path).join(","));

        return;
    }
    // Imported fake items point at files in OTHER folders (database import
    // feature) — they exist only to inform the move decision, never to be
    // moved themselves.
    data.filter(f => f.checked === bol && !f.imported).forEach(media => {
        // let completeDestine = path.join(path.dirname(media.path), dest);
        const completeDestine = path.join(fileGlobal as string, "tmp", dest);
        if (!fs.existsSync(completeDestine)) {
            fs.mkdirSync(completeDestine);
        }
        if (!fs.existsSync(media.path)) {
            reportFileProcessed(media, onlyCopy, new Error("Source file no longer exists"));
            return;
        }
        const destination = path.join(completeDestine, path.basename(media.path));
        if (onlyCopy) {
            fs.copyFile(media.path, destination, (err) => {
                reportFileProcessed(media, onlyCopy, err);
            });
        } else {
            fs.rename(media.path, destination, (err) => {
                if (!err) { reportFileProcessed(media, onlyCopy); return; }
                if (err.code !== "EXDEV") {
                    reportFileProcessed(media, onlyCopy, err);
                    return;
                }
                // rename cannot cross volumes: fall back to copy + delete
                fs.copyFile(media.path, destination, (copyErr) => {
                    if (copyErr) {
                        reportFileProcessed(media, onlyCopy, copyErr);
                        return;
                    }
                    fs.unlink(media.path, (unlinkErr) => {
                        reportFileProcessed(media, onlyCopy, unlinkErr);
                    });
                });
            });
        }
    });
};
const openfile = (): void => {
    mainWindow!.title = `Get Images in ${fileGlobal}`;

    fs.readdir(fileGlobal as string, "utf8", (err, data) => {
        if (err) { console.error(err); return; }

        mainWindow!.webContents.send("cleanGrid");

        console.log(`Get Images in ${fileGlobal}`, "files", data.length);

        mainWindow!.webContents.send("mediaLoadStart");

        streamingMedia(data, fileGlobal as string, () => {
            mainWindow!.webContents.send("mediaLoadComplete");
        });
    });
};


const streamingMedia = (data: string[], root: string, complete: () => void): void => {
    transformDataStreaming(
        data,
        root,
        (mediaReady: StreamMediaItem[]) => {
            mainWindow!.webContents.send("loadMedias", mediaReady);
        },
        (mediaLazy: StreamMediaItem) => {
            // console.log("Video found", video.id);
            mainWindow!.webContents.send("addOneMedia", mediaLazy);
        },
        complete
    );
};


/************************************ MENU */




const zoomImg = async (zoom: number): Promise<void> => {
    try {

        mainWindow!.webContents.send("zoom", zoom);
    } catch (error) {
        console.error("Zoom error", error);

    }
};

const loadFolders = async (): Promise<void> => {
    try {
        fs.readdir(fileGlobal as string, { encoding: "utf8", withFileTypes: true }, (err, data) => {
            if (err) console.error(err);
            else {
                mainWindow!.webContents.send("menuOpen",

                    data
                        .filter(d => d.isDirectory() && d.name !== "tmp")
                        .map(d => d.name)
                );

            }
        }
        );
    } catch (error) {
        console.error("Error in load folders", error);

    }

};


ipcMain.on("openRecursive", () => { if (!rejectIfBusy()) loadRecursive(); });
const loadRecursive = async (): Promise<void> => {

    const options: OpenDialogOptions = {
        properties: ["openDirectory", 'promptToCreate'],
        title: "Open folder recursive to choice medias",
    };
    if (fileGlobal) options.defaultPath = fileGlobal;
    dialog.showOpenDialog(options).then(file => {
        if (!file.canceled) {
            setActiveFolder(file.filePaths[0]);
            redirectToActiveFolder();
            fileGlobal = file.filePaths[0]; // path.join(file.filePaths[0], "tmp");
            compareImgStore.closeConnection();


            mainWindow!.webContents.send("cleanGrid");
            mainWindow!.webContents.send("mediaLoadStart");
            openfileRecursive(file.filePaths[0]);

        } else {
            // Dialog cancelled: a super execution that already picked its
            // model has nothing left to scan, so don't leave the flag (or
            // pipelineRun) set for some later unrelated recursive open to
            // accidentally chain into.
            cancelSuperExecutionIfPending();
        }
    }).catch(err => {
        console.error(err);
        cancelSuperExecutionIfPending();
    });
};

// File > "Load super recursive": picks the ONNX/.maloi model up front (the
// same dialog "Choose ONNX model" uses - detectObjects, the last stage of
// this chain, refuses to run without one, so better to ask before the whole
// recursive scan+index+dup-scan runs than after). If the user cancels with
// no model configured at all, the chain never starts. Otherwise it opens the
// recursive-folder dialog exactly like "Load recursive" - the rest of the
// chain (buildIndex -> findIndexDuplicates -> detectObjects) picks up once
// the scan itself finishes, see notifyMediaLoadComplete.
const loadSuperRecursive = async (): Promise<void> => {
    if (rejectIfBusy()) return;
    const modelAvailable = await chooseOnnxModelDialog();
    if (!modelAvailable) {
        console.log("Super execution cancelled: no ONNX model configured");
        return;
    }
    // Claims the pipeline slot before the folder-choose dialog even opens,
    // so rejectIfBusy above already covers "double-click Load super
    // recursive while the first click's model dialog is still open" - not
    // just the scan/index/detect/duplicates stages that follow it.
    if (!pipelineRun.begin("Load super recursive", SUPER_STAGES)) return;
    pipelineRun.startStage("scan");
    updateMenu();
    superExecutionInProgress = true;
    await loadRecursive();
};

// Shared by loadRecursive's cancel/catch branches: undoes loadSuperRecursive's
// claim on the pipeline slot (and re-enables the menu) when the folder-choose
// dialog it opened gets cancelled or errors before any real work started -
// otherwise pipelineRun would stay "running" forever with nothing left to
// finish it. A no-op for a plain "Load recursive" (superExecutionInProgress
// is only ever true mid-loadSuperRecursive).
const cancelSuperExecutionIfPending = (): void => {
    if (!superExecutionInProgress) return;
    superExecutionInProgress = false;
    pipelineRun.cancel("No folder chosen");
    updateMenu();
};

let processedFolders: Record<string, boolean> = {};

// Wraps the existing "recursive scan fully finished" signal so
// loadSuperRecursive can chain into buildIndex+detectObjects right as it
// fires, instead of the renderer needing to trigger each stage itself.
const notifyMediaLoadComplete = (): void => {
    mainWindow!.webContents.send("mediaLoadComplete");
    if (superExecutionInProgress) {
        superExecutionInProgress = false;
        // chooseOnnxModelDialog (called by loadSuperRecursive) persists the
        // .maloi's classes/model path BEFORE the recursive-folder dialog
        // even opens, since detectObjects refuses to run without a model
        // picked first. index.db is per-folder though (HashStore closes and
        // reopens its connection against the newly chosen folder - see
        // loadRecursive), so that early save lands in whatever folder's DB
        // was active beforehand, never the one just scanned. Re-persist
        // here, now that the correct folder's DB is the one open (from this
        // scan's own MediaStore.ensureReady calls) and right before the
        // pipeline reads/writes it - saveDetectionClasses/getOrCreateModelPath
        // are both idempotent so this is safe to redo.
        MediaStore.ensureReady();
        MediaStore.saveDetectionClasses(onnxDetector.getClassNames());
        if (onnxDetector.getModelPath()) MediaStore.getOrCreateModelPath(onnxDetector.getModelPath() as string);
        runSuperExecutionPipeline().catch(error => {
            // runSuperExecutionPipeline already reports failures through
            // pipelineRun.fail internally - this catch only guards against a
            // truly unexpected throw escaping that try/catch.
            console.error("super execution pipeline failed", error);
        });
    }
};

const openfileRecursive = (folderPath: string): void => {


    mainWindow!.title = `Get Images in ${fileGlobal} recursive in ${folderPath}`;

    fs.readdir(folderPath, "utf8", (err, data) => {
        if (err) { console.error(err); return; }
        const qtdFiles = data.map(item => path.join(folderPath, item)).filter(item => fs.statSync(item).isFile()).length;
        data.filter(item => item !== "tmp").map(item => path.join(folderPath, item)).filter(item => fs.statSync(item).isDirectory()).forEach(item => {
            processedFolders[item] = false;
            openfileRecursive(item);
        });

        if (qtdFiles > 0) {
            streamingMedia(data, folderPath, () => {
                // nothing to do here, the onDone callback is just to signal the end of the stream
                processedFolders[folderPath] = true;
                if (Object.values(processedFolders).every(v => v === true)) {
                    console.log("All folders processed");
                    notifyMediaLoadComplete();
                }
            });
        } else {
            processedFolders[folderPath] = true;
        }


    });
};

const cleanGrid = async (): Promise<void> => { mainWindow!.webContents.send("cleanGrid"); };

// Sorting itself lives in redux (media.reduce.ts orderByName/orderBySize/
// orderByFolder) - these just forward which order the user picked.
const sortByName = async (): Promise<void> => {
    if (mainWindow) {
        mainWindow.webContents.send("sort", "sortByName");
    }
};
const sortBySize = async (): Promise<void> => {
    if (mainWindow) {
        mainWindow.webContents.send("sort", "sortBySize");
    }
};
const sortBySizeInverted = async (): Promise<void> => {
    if (mainWindow) {
        mainWindow.webContents.send("sort", "sortBySizeInverted");
    }
};
const sortByFolder = async (): Promise<void> => {
    if (mainWindow) {
        mainWindow.webContents.send("sort", "sortByFolder");
    }
};

app.whenReady().then(() => {
    installExtension([REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS])
        .then((installed) => console.log(`Added Extensions:  ${installed.map((e) => e.name).join(", ")}`))
        .catch((err) => console.log('An error occurred: ', err));
});
