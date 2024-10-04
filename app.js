const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const url = require("url");
const path = require("path");
const fs = require("fs");

const mime = require('mime-types');
const { execSync } = require('child_process');

const isMac = process.platform === 'darwin'
var mainWindow;
function createWindow() {
    mainWindow = new BrowserWindow({
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

    mainWindow.loadFile(path.join(__dirname, `/build/index.html`));
    // mainWindow.loadURL(url.format({
    //     pathname: path.join(__dirname, `/build/index.html`),
    //     protocol: 'file:',
    //     slashes: false
    // }))
    // Open the DevTools.
    mainWindow.webContents.openDevTools();

    mainWindow.on("closed", function () {
        mainWindow = null;
    });

    const template = [
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
            ]
        },

    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)


    if (process.argv[2]) {
        console.log("File receive folder", process.argv)
        fileGlobal = process.argv[2]
    } else if (process.argv[0].includes("getimage")) {
        fileGlobal = process.argv[1]
    }
}

app.on("ready", createWindow);

app.on("window-all-closed", function () {
    if (isMac) app.quit();
    else process.exit(0)
});

app.on('before-quit', () => {
    mainWindow.removeAllListeners('close');
    mainWindow.close();
});
/********************************************** */

app.on("activate", function () {
    if (mainWindow === null) createWindow();
});
var fileGlobal;

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
        moveFile(true, "L", data)
        moveFile(false, "R", data)
    }
})

ipcMain.on("verifyOpen", async () => {
    if (fileGlobal) {
        openfile()
    }
})

const moveFile = (bol, dest, data) =>
    data.filter(f => f.checked === bol).forEach(f => {
        let completeDestine = path.join(path.dirname(f.path), dest);
        if (!fs.existsSync(completeDestine)) {
            fs.mkdirSync(completeDestine)
        }
        fs.rename(f.path, path.join(completeDestine, path.basename(f.path)), (err) => {
            if (err) throw err;
        })
    });


const openfile = () => {
    mainWindow.title = `Get Images in ${fileGlobal}`

    fs.readdir(fileGlobal, "utf8", (err, data) => {
        if (err) console.error(err);
        else {
            console.log(`Get Images in ${fileGlobal}`, "files", data.length);
            mainWindow.webContents.send("directoryOpen",
                data.map(item => path.join(fileGlobal, item))
                    .filter(item => fs.statSync(item)
                        .isFile()
                    )
                    .map(item => {
                        return { item: item, mime: mime.lookup(item), fileName: item, size: fs.statSync(item).size }
                    })
                    .filter(item => {
                        const mime_type = item.mime
                        return mime_type && (mime_type.includes('image') || mime_type.includes('video'))
                    })
                    .sort((a, b) => b.size - a.size)
                    .map(item => {

                        const mime_type = item.mime
                        if (mime_type && mime_type.includes('video')) {
                            let fileName = `/tmp/${item.item.replaceAll("/", "_")}.jpeg`
                            item.fileName = fileName
                            if (!fs.existsSync(fileName)) {
                                try {
                                    execSync(`ffmpegthumbnailer -s300 -i '${item.item}' -o '${fileName}' -f `)

                                } catch (error) {
                                    console.error(error);
                                    return undefined
                                }
                            }

                        }
                        return item

                    })
            );
        }
    });
};

