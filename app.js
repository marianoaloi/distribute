const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

const isMac = process.platform === 'darwin'


var dto = { mainWindow: undefined, fileGlobal: undefined }

const utilMenu = require('./menu')

const menuTemplate = utilMenu.menu(dto)
function createWindow() {
    dto.mainWindow = new BrowserWindow({
        // width: 1200,
        // height: 600,
        icon: path.join(__dirname, `/build/logo512.png`),
        webPreferences: {
            // nodeIntegration: true,
            contextIsolation: true,
            nodeIntegration: true,
            enableRemoteModule: true,
            // contextIsolation: false,
            spellcheck: true,
            preload: path.join(__dirname, 'preload.js'),
        },
        options: {
            fullscreen: true
        },
    });

    dto.mainWindow.loadFile(path.join(__dirname, `/build/index.html`));
    // dto.mainWindow.loadURL(url.format({
    //     pathname: path.join(__dirname, `/build/index.html`),
    //     protocol: 'file:',
    //     slashes: false
    // }))
    // Open the DevTools.
    dto.//mainWindow.webContents.openDevTools();

    dto.mainWindow.on("closed", function () {
        dto.mainWindow = null;
    });



    const menu = Menu.buildFromTemplate(menuTemplate)
    Menu.setApplicationMenu(menu)


    if (process.argv[2]) {
        console.log("File receive folder", process.argv)
        dto.fileGlobal = process.argv[2]
    } else if (process.argv[0].includes("getimage")) {
        dto.fileGlobal = process.argv[1]
    }


}



app.on("ready", createWindow);

app.on("window-all-closed", function () {
    if (isMac) app.quit();
    else process.exit(0)
});

app.on('before-quit', () => {
    dto.mainWindow.removeAllListeners('close');
    dto.mainWindow.close();
});
/********************************************** */

app.on("activate", function () {
    if (dto.mainWindow === null) createWindow();
});

ipcMain.on("open", () => {
    let options = {
        properties: ["openDirectory", 'promptToCreate'],
        title: "Open folder to choice images",
    };
    if (dto.fileGlobal) options["defaultPath"] = dto.fileGlobal;
    dialog.showOpenDialog(options).then(file => {
        if (!file.canceled) {
            dto.fileGlobal = file.filePaths[0];
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

ipcMain.on("verifyOpen", async () => {
    if (dto.fileGlobal) {
        openfile()
    }
})

const moveFile = (bol, dest, onlyCopy, data) =>
    data.filter(f => f.checked === bol).forEach(media => {
        // let completeDestine = path.join(path.dirname(media.path), dest);
        let completeDestine = path.join(dto.fileGlobal, dest);
        if (!fs.existsSync(completeDestine)) {
            fs.mkdirSync(completeDestine)
        }
        if (fs.existsSync(media.path))
            if (onlyCopy) {
                fs.copyFile(media.path, path.join(completeDestine, path.basename(media.path)), (err) => {
                    if (err) throw err;
                })
            } else {
                fs.rename(media.path, path.join(completeDestine, path.basename(media.path)), (err) => {
                    if (err) throw err;
                })
            }
        // dto.mainWindow.ipcMain.send("delete", media)
    });

const transformData = require("./util").transformData
const openfile = () => {
    dto.mainWindow.title = `Get Images in ${dto.fileGlobal}`


    fs.readdir(dto.fileGlobal, "utf8", (err, data) => {
        if (err) console.error(err);
        else {
            console.log(`Get Images in ${dto.fileGlobal}`, "files", data.length);
            dto.mainWindow.webContents.send("directoryOpen",
                transformData(data, dto.fileGlobal, 0)
            );
        }
    });
};

