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
const { dirCache } = require("./DirectorioCache");
const duplicateFinder = require("./compareImg/duplicateFinder");
const transformData = util.transformData;
const transformDataStreaming = util.transformDataStreaming;
var actualSort = util.sortSize;

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
        label: 'Order',
        submenu: [
            { label: "Sort by Name", type: "radio", checked: actualSort === util.sortName, click: sortByName },
            { label: "Sort by Size", type: "radio", checked: actualSort === util.sortSize, click: sortBySize },
            { label: "Sort by Folder", type: "radio", checked: actualSort === util.sortFolder, click: sortByFolder },
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

ipcMain.on("findDuplicates", async (event, data) => {
    try {
        const groups = await duplicateFinder.findDuplicates(data.medias);
        mainWindow.webContents.send("duplicatesFound", groups);
    } catch (error) {
        console.error("findDuplicates failed", error);
        mainWindow.webContents.send("duplicatesFound", []);
    }
})

ipcMain.on("findIndexDuplicates", async () => {
    try {
        const groups = await duplicateFinder.findIndexDuplicates();
        mainWindow.webContents.send("duplicatesFound", groups);
    } catch (error) {
        console.error("findIndexDuplicates failed", error);
        mainWindow.webContents.send("duplicatesFound", []);
    }
})

ipcMain.on("verifyOpen", async () => {
    if (process.env.FixFiles && fs.existsSync(process.env.FixFiles)) {
        fs.readFile(process.env.FixFiles, 'utf8', (err, data) => {
            let files = data.split("|").filter(filepath => fs.existsSync(filepath))
            files = util.transformFixedData(files, 0, util.sortSize)

            mainWindow.webContents.send("directoryOpen", files);
        })
    } else
        if (fileGlobal) {
            openfile()
        }
})

const moveFile = (bol, dest, onlyCopy, data) => {
    if (process.env.FixFiles) {
        console.log("##MOVEFILE", dest, data.filter(f => f.checked === bol).map(f => f.path).join(","));

        return;
    }
    data.filter(f => f.checked === bol).forEach(media => {
        // let completeDestine = path.join(path.dirname(media.path), dest);
        let completeDestine = path.join(fileGlobal, dest);
        if (!fs.existsSync(completeDestine)) {
            fs.mkdirSync(completeDestine)
        }
        if (fs.existsSync(media.path)) {
            const destination = path.join(completeDestine, path.basename(media.path));
            if (onlyCopy) {
                fs.copyFile(media.path, destination, (err) => {
                    if (err) console.error("Copy failed for", media.path, "-", err);
                })
            } else {
                fs.rename(media.path, destination, (err) => {
                    if (!err) return;
                    if (err.code !== "EXDEV") {
                        console.error("Move failed for", media.path, "-", err);
                        return;
                    }
                    // rename cannot cross volumes: fall back to copy + delete
                    fs.copyFile(media.path, destination, (copyErr) => {
                        if (copyErr) {
                            console.error("Move (copy fallback) failed for", media.path, "-", copyErr);
                            return;
                        }
                        fs.unlink(media.path, (unlinkErr) => {
                            if (unlinkErr) console.error("Move (source cleanup) failed for", media.path, "-", unlinkErr);
                        });
                    });
                })
            }
        }
        // mainWindow.ipcMain.send("delete", media)
    });
}
const openfile = () => {
    mainWindow.title = `Get Images in ${fileGlobal}`

    fs.readdir(fileGlobal, "utf8", (err, data) => {
        if (err) { console.error(err); return; }

        console.log(`Get Images in ${fileGlobal}`, "files", data.length);

        transformDataStreaming(
            data,
            fileGlobal,
            0,
            actualSort,
            (images) => {
                mainWindow.webContents.send("directoryOpen", images);
            },
            (video) => {
                // console.log("Video found", video.id);
                mainWindow.webContents.send("addOneMedia", video);
            }
        );
    });
};





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
                        .filter(d => d.isDirectory())
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
            openfileRecursive(file.filePaths[0]);

            mainWindow.title = `Get Images in ${fileGlobal} recursive in ${file.filePaths[0]}`
        }
    }).catch(err => {
        console.error(err);
    });
}

var counter = 0
const openfileRecursive = (folderPath) => {


    fs.readdir(folderPath, "utf8", (err, data) => {
        if (err) { console.error(err); return; }
        let qtdFiles = data.map(item => path.join(folderPath, item)).filter(item => fs.statSync(item).isFile()).length
        data.map(item => path.join(folderPath, item)).filter(item => fs.statSync(item).isDirectory()).forEach(item => openfileRecursive(item))

        if (qtdFiles > 0)
            mainWindow.webContents.send("loadMedias",
                transformData(data, folderPath, counter, actualSort)
            );
        counter += qtdFiles
    })
}

const cleanGrid = async () => { mainWindow.webContents.send("cleanGrid") }

const sortByName = async () => {
    actualSort = util.sortName;
    updateMenu();
    if (fileGlobal) {
        openfile();
    }
    if (mainWindow) {
        mainWindow.webContents.send("sort", "sortByName");
    }
}
const sortBySize = async () => {
    actualSort = util.sortSize;
    updateMenu();
    if (fileGlobal) {
        openfile();
    }
    if (mainWindow) {
        mainWindow.webContents.send("sort", "sortBySize");
    }
}
const sortByFolder = async () => {
    actualSort = util.sortFolder;
    updateMenu();
    if (fileGlobal) {
        openfile();
    }
    if (mainWindow) {
        mainWindow.webContents.send("sort", "sortByFolder");
    }
}

app.whenReady().then(() => {
    installExtension([REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS])
        .then(([redux, react]) => console.log(`Added Extensions:  ${redux.name}, ${react.name}`))
        .catch((err) => console.log('An error occurred: ', err));
})