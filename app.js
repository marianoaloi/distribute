const { app, BrowserWindow, ipcMain, dialog, Menu, protocol } = require("electron");
const path = require("path");
const fs = require("fs");
const { default: installExtension, REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS } = require("electron-devtools-installer");

const isDev = process.env.NODE_ENV === "development";
const isMac = process.platform === 'darwin'
protocol.registerSchemesAsPrivileged([
    { scheme: 'local-media', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } }
]);



const os = require('os');
const util = require("./util");
const { setActiveFolder } = require("./DirectorioCache");
const duplicateFinder = require("./compareImg/duplicateFinder");
const compareImgStore = require("./compareImg/HashStore");
const mediaIndexer = require("./compareImg/mediaIndexer");
const dbImport = require("./compareImg/dbImport");
const { hashFor } = require("./thumbnails/cache");
const onnxDetector = require("./objectDetection/onnxDetector");
const MediaStore = require("./mediaDb/MediaStore");
const transformDataStreaming = util.transformDataStreaming;

var menuTemplate = () => [
    {
        label: 'File',
        submenu: [
            { label: 'Load recursive', click: loadRecursive }
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

]

const updateMenu = () => {
    try {
        const menu = Menu.buildFromTemplate(menuTemplate())
        Menu.setApplicationMenu(menu)
    } catch (error) {
        console.error("Error setting application menu", error);
    }
}
var mainWindow
var fileGlobal
function createWindow() {
    try {
        require("./thumbnails/ThumbnailService").ensureCacheDir()
    } catch (error) {
        console.error("Error creating tmp folder", error);
    }
    mainWindow = new BrowserWindow({
        // width: 1200,
        // height: 600,
        icon: path.join(__dirname, `/build/logo512.png`),
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            spellcheck: true,
            preload: path.join(__dirname, 'preload.js'),
        },
        options: {
            fullscreen: true
        },
    });

    const startURL = isDev
        ? 'http://localhost:7845'
        : `file://${path.join(__dirname, `/build/index.html`)}`;

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
            console.log("File receive folder", process.argv)
            fileGlobal = process.argv[2]
        } else if (process.argv[0].includes("getimage")) {
            fileGlobal = process.argv[1]
        }
    } catch (error) {
        console.error("Error processing command line arguments", error);
    }


    mainWindow.focus()

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
    else process.exit(0)
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
    let options = {
        properties: ["openDirectory", 'promptToCreate'],
        title: "Open folder to choice images",
    };
    if (fileGlobal) options["defaultPath"] = fileGlobal;
    dialog.showOpenDialog(options).then(file => {
        if (!file.canceled) {
            fileGlobal = file.filePaths[0];
            setActiveFolder(fileGlobal);
            compareImgStore.closeConnection();
        }
        openfile();
    }).catch(err => {
        console.error(err);
    });

});

ipcMain.on("process", async (event, data) => {
    if (data) {
        moveFile(true, data.folder, data.onlyCopy, data.data)
    }
})

const findIndexDuplicates = async () => {
    try {
        const groups = await duplicateFinder.findIndexDuplicates();
        mainWindow.webContents.send("duplicatesFound", groups);
    } catch (error) {
        console.error("findIndexDuplicates failed", error);
        mainWindow.webContents.send("duplicatesFound", []);
    }
}
ipcMain.on("findIndexDuplicates", findIndexDuplicates)

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

// Lets the user pick any .onnx model file instead of the old fixed
// ./xcxv/best.onnx path. Sends the chosen path (or the still-unset current
// one, if canceled) back so the renderer can reflect it and gate the run button.
ipcMain.on("chooseOnnxModel", () => {
    const options = {
        properties: ["openFile"],
        title: "Choose ONNX model for object detection",
        filters: [{ name: "ONNX model", extensions: ["onnx"] }],
    };
    dialog.showOpenDialog(options).then(file => {
        if (!file.canceled && file.filePaths[0]) {
            onnxDetector.setModelPath(file.filePaths[0]);
        }
        mainWindow.webContents.send("onnxModelChosen", { path: onnxDetector.getModelPath() });
    }).catch(err => {
        console.error(err);
    });
});

ipcMain.on("detectObjects", async (event, data) => {
    const medias = (data && data.medias) || [];
    if (!onnxDetector.isAvailable()) {
        mainWindow.webContents.send("detectionsComplete", { error: "No ONNX model selected - choose a model file first" });
        return;
    }
    detectionStopRequested = false;
    let processed = 0;
    const total = medias.length;
    // A media already has a stored result for the *current* class list when
    // its snapshot matches classesSnapshot below - skip re-running the model
    // on it and just replay what's already in media_detection. Any class
    // list edit changes the snapshot, so a redo is forced for everyone again.
    const classesSnapshot = onnxDetector.getClassNames().join(",");
    const mediaState = MediaStore.findMediaByIds(medias.map((media) => media.id));

    // Detection runs 20 medias at a time: the awaited parts (file read, JPEG
    // decode, letterbox, session.run scheduling) overlap instead of queueing
    // behind each other. The native inference itself still runs one at a time
    // on the main process thread - the win is in everything around it.
    const DETECTION_BATCH_SIZE = 20;

    const processOne = async (media) => {
        const state = mediaState.get(media.id);
        const alreadyRecognized = Boolean(state && state.detectionAt && state.detectionClasses === classesSnapshot);
        if (alreadyRecognized) {
            const boxes = MediaStore.getDetections(media.id);
            mainWindow.webContents.send("detectionFound", { id: media.id, boxes });
        } else {
            try {
                const boxes = await onnxDetector.detect(media.media);
                mainWindow.webContents.send("detectionFound", { id: media.id, boxes });
                try {
                    MediaStore.replaceDetections(media.id, boxes, onnxDetector.getModelPath());
                    MediaStore.setDetectionState(media.id, classesSnapshot);
                } catch (error) {
                    console.error("Persisting detections failed for", media.media, error);
                }
            } catch (error) {
                console.error("detectObjects failed for", media.media, error);
                mainWindow.webContents.send("detectionFound", { id: media.id, boxes: [], error: error.message });
            }
        }
        processed++;
        mainWindow.webContents.send("detectionProgress", { processed, total });
    };

    for (let i = 0; i < medias.length; i += DETECTION_BATCH_SIZE) {
        // Stop is honoured between batches - an in-flight batch is allowed to
        // finish so its already-computed boxes still get persisted and shown.
        if (detectionStopRequested) break;
        await Promise.allSettled(medias.slice(i, i + DETECTION_BATCH_SIZE).map(processOne));
    }

    mainWindow.webContents.send("detectionsComplete", detectionStopRequested ? { stopped: true } : {});
})

// Persists the user-typed comma-separated class list (mediaDb's
// detection_class table, per-folder like the rest of index.db) and pushes it
// into onnxDetector so subsequent detections use the real names instead of
// "class N". The main process owns the split - the renderer always sends the
// raw string. detectionClassesLoaded is the reply to both this and
// loadDetectionClasses, so the UI can never drift from what got persisted.
ipcMain.on("saveDetectionClasses", (event, data) => {
    try {
        const raw = (data && data.classes) || "";
        const names = String(raw).split(",").map((s) => s.trim()).filter((s) => s.length > 0);
        MediaStore.ensureReady();
        MediaStore.saveDetectionClasses(names);
        onnxDetector.setClassNames(names);
        mainWindow.webContents.send("detectionClassesLoaded", { names });
    } catch (error) {
        console.error("saveDetectionClasses failed", error);
        mainWindow.webContents.send("detectionClassesLoaded", { names: [], error: error.message });
    }
});

ipcMain.on("loadDetectionClasses", () => {
    try {
        MediaStore.ensureReady();
        const names = MediaStore.getDetectionClasses();
        onnxDetector.setClassNames(names);
        mainWindow.webContents.send("detectionClassesLoaded", { names });
    } catch (error) {
        console.error("loadDetectionClasses failed", error);
        mainWindow.webContents.send("detectionClassesLoaded", { names: [], error: error.message });
    }
});

// Hydrates every persisted detection for the current folder into the renderer
// in one message, so the grid's class filter works on a freshly opened folder
// without the user having to press Play again. index.db is per-folder, so no
// id list is needed - the whole media_detection table is the current media.
ipcMain.on("loadDetections", () => {
    try {
        MediaStore.ensureReady();
        const rows = MediaStore.getAllDetections();
        const byId = new Map();
        for (const row of rows) {
            const { mediaId, ...box } = row;
            if (!byId.has(mediaId)) byId.set(mediaId, []);
            byId.get(mediaId).push(box);
        }
        const items = [...byId].map(([id, boxes]) => ({ id, boxes }));
        mainWindow.webContents.send("detectionsLoaded", { items });
    } catch (error) {
        console.error("loadDetections failed", error);
        mainWindow.webContents.send("detectionsLoaded", { items: [], error: error.message });
    }
});

// Wipes the (possibly corrupted) compareImg sqlite index and re-indexes the
// media the renderer already has loaded in redux, so the user doesn't need
// to re-open/re-scan the folder to recover from a corrupted index.db.
ipcMain.on("rebuildIndex", async (event, data) => {
    try {
        await compareImgStore.rebuildIndex();
        const medias = (data && data.medias) || [];
        mainWindow.webContents.send("indexRebuildProgress", { processed: 0, total: medias.length });
        await mediaIndexer.indexMediaBackground(medias.map(m => ({
            item: m.path,
            mime: m.mime,
            id: m.id,
        })), (processed, total) => {
            mainWindow.webContents.send("indexRebuildProgress", { processed, total });
        });
        mainWindow.webContents.send("indexRebuilt", { success: true, count: medias.length });
    } catch (error) {
        console.error("rebuildIndex failed", error);
        mainWindow.webContents.send("indexRebuilt", { success: false, error: error.message });
    }
    findIndexDuplicates();
})

// Exports a consistent snapshot of the compareImg sqlite index so it can be
// carried to another machine/folder and later imported for cross-library
// duplicate comparison (the import/compare side is a follow-up feature).
ipcMain.on("exportDatabase", async () => {
    const options = {
        title: "Export duplicate-detection database",
        defaultPath: path.join(app.getPath("documents"), `index-export-${Date.now()}.db`),
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
    };
    try {
        const result = await dialog.showSaveDialog(mainWindow, options);
        if (result.canceled || !result.filePath) {
            mainWindow.webContents.send("databaseExported", { success: false, canceled: true });
            return;
        }
        await compareImgStore.exportDatabase(result.filePath);
        mainWindow.webContents.send("databaseExported", { success: true, path: result.filePath });
    } catch (error) {
        console.error("exportDatabase failed", error);
        mainWindow.webContents.send("databaseExported", { success: false, error: error.message });
    }
})

// Compares another folder's exported index against the live one (readonly —
// nothing is merged into index.db) and streams each matched external file to
// the renderer as a transient "imported" fake item, so the duplicates page
// can show cross-folder groups and the user can decide what to move.
// Full flow lives in compareImg/dbImport.js.
ipcMain.on("importDatabase", () =>
    dbImport.runImportFlow({ dialog, mainWindow, transformDataStreaming, hashFor }))

ipcMain.on("verifyOpen", async () => {
    if (process.env.FixFiles && fs.existsSync(process.env.FixFiles)) {
        fs.readFile(process.env.FixFiles, 'utf8', (err, data) => {
            let files = data.split("|").filter(filepath => fs.existsSync(filepath))
            files = util.transformFixedData(files)

            mainWindow.webContents.send("directoryOpen", files);
        })
    } else
        if (fileGlobal) {
            openfile()
        }
})

// Reports whether a single media's file operation actually finished on
// disk, so the renderer can mark it moved/deleted only once that's true
// instead of assuming success the moment the button was clicked (a failed
// move used to silently vanish the item from the grid while the file stayed
// put in the source folder).
const reportFileProcessed = (media, onlyCopy, error) => {
    if (error) console.error(onlyCopy ? "Copy failed for" : "Move failed for", media.path, "-", error);
    mainWindow.webContents.send("fileProcessed", {
        id: media.id,
        onlyCopy,
        success: !error,
        error: error ? error.message : undefined,
    });
};

const moveFile = (bol, dest, onlyCopy, data) => {
    if (process.env.FixFiles) {
        console.log("##MOVEFILE", dest, data.filter(f => f.checked === bol).map(f => f.path).join(","));

        return;
    }
    // Imported fake items point at files in OTHER folders (database import
    // feature) — they exist only to inform the move decision, never to be
    // moved themselves.
    data.filter(f => f.checked === bol && !f.imported).forEach(media => {
        // let completeDestine = path.join(path.dirname(media.path), dest);
        let completeDestine = path.join(fileGlobal, dest);
        if (!fs.existsSync(completeDestine)) {
            fs.mkdirSync(completeDestine)
        }
        if (!fs.existsSync(media.path)) {
            reportFileProcessed(media, onlyCopy, new Error("Source file no longer exists"));
            return;
        }
        const destination = path.join(completeDestine, path.basename(media.path));
        if (onlyCopy) {
            fs.copyFile(media.path, destination, (err) => {
                reportFileProcessed(media, onlyCopy, err);
            })
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
            })
        }
    });
}
const openfile = () => {
    mainWindow.title = `Get Images in ${fileGlobal}`

    fs.readdir(fileGlobal, "utf8", (err, data) => {
        if (err) { console.error(err); return; }

        mainWindow.webContents.send("cleanGrid");

        console.log(`Get Images in ${fileGlobal}`, "files", data.length);

        mainWindow.webContents.send("mediaLoadStart");

        streamingMedia(data, fileGlobal, () => {
            mainWindow.webContents.send("mediaLoadComplete");
        });
    });
};


const streamingMedia = (data, root, complete) => {
    transformDataStreaming(
        data,
        root,
        (mediaReady) => {
            mainWindow.webContents.send("loadMedias", mediaReady);
        },
        (mediaLazy) => {
            // console.log("Video found", video.id);
            mainWindow.webContents.send("addOneMedia", mediaLazy);
        },
        complete
    );
}


/************************************ MENU */




const zoomImg = async (zoom) => {
    try {

        mainWindow.webContents.send("zoom", zoom)
    } catch (error) {
        console.error("Zoom error", error);

    }
}

const loadFolders = async () => {
    try {
        fs.readdir(fileGlobal, { encoding: "utf8", withFileTypes: true }, (err, data) => {
            if (err) console.error(err);
            else {
                mainWindow.webContents.send("menuOpen",

                    data
                        .filter(d => d.isDirectory() && d.name !== "tmp")
                        .map(d => d.name)
                );

            }
        }
        )
    } catch (error) {
        console.error("Error in load folders", error);

    }

}


ipcMain.on("openRecursive", () => loadRecursive())
const loadRecursive = async () => {

    let options = {
        properties: ["openDirectory", 'promptToCreate'],
        title: "Open folder recursive to choice medias",
    };
    if (fileGlobal) options["defaultPath"] = fileGlobal;
    dialog.showOpenDialog(options).then(file => {
        if (!file.canceled) {
            setActiveFolder(file.filePaths[0]);
            fileGlobal = file.filePaths[0]; // path.join(file.filePaths[0], "tmp");
            compareImgStore.closeConnection();


            mainWindow.webContents.send("cleanGrid");
            mainWindow.webContents.send("mediaLoadStart");
            openfileRecursive(file.filePaths[0]);

        }
    }).catch(err => {
        console.error(err);
    });
}

var processedFolders = {};
const openfileRecursive = (folderPath) => {


    mainWindow.title = `Get Images in ${fileGlobal} recursive in ${folderPath}`

    fs.readdir(folderPath, "utf8", (err, data) => {
        if (err) { console.error(err); return; }
        let qtdFiles = data.map(item => path.join(folderPath, item)).filter(item => fs.statSync(item).isFile()).length
        data.filter(item => item !== "tmp").map(item => path.join(folderPath, item)).filter(item => fs.statSync(item).isDirectory()).forEach(item => {
            processedFolders[item] = false;
            openfileRecursive(item)
        });

        if (qtdFiles > 0) {
            streamingMedia(data, folderPath, () => {
                // nothing to do here, the onDone callback is just to signal the end of the stream
                processedFolders[folderPath] = true;
                if (Object.values(processedFolders).every(v => v === true)) {
                    console.log("All folders processed");
                    mainWindow.webContents.send("mediaLoadComplete");
                }
            });
        } else {
                processedFolders[folderPath] = true;
        }


    })
}

const cleanGrid = async () => { mainWindow.webContents.send("cleanGrid") }

// Sorting itself lives in redux (media.reduce.ts orderByName/orderBySize/
// orderByFolder) - these just forward which order the user picked.
const sortByName = async () => {
    if (mainWindow) {
        mainWindow.webContents.send("sort", "sortByName");
    }
}
const sortBySize = async () => {
    if (mainWindow) {
        mainWindow.webContents.send("sort", "sortBySize");
    }
}
const sortBySizeInverted = async () => {
    if (mainWindow) {
        mainWindow.webContents.send("sort", "sortBySizeInverted");
    }
}
const sortByFolder = async () => {
    if (mainWindow) {
        mainWindow.webContents.send("sort", "sortByFolder");
    }
}

app.whenReady().then(() => {
    installExtension([REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS])
        .then(([redux, react]) => console.log(`Added Extensions:  ${redux.name}, ${react.name}`))
        .catch((err) => console.log('An error occurred: ', err));
})