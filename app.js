const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

const isMac = process.platform === 'darwin'


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
        ]
    },
    {
        label: 'Order',
        submenu: [
            {label:"Sort by Name" , click:sortByName},
            {label:"Sort by Size" , click:sortBySize},
            {label:"Sort by Folder" , click:sortByFolder},
        ]
    },

]
var mainWindow
var fileGlobal
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



    const menu = Menu.buildFromTemplate(menuTemplate())
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

ipcMain.on("verifyOpen", async () => {
    if(process.env.FixFiles && fs.existsSync(process.env.FixFiles)){
        fs.readFile(process.env.FixFiles,'utf8',(err,data)=>{
            let files=data.split("|").filter(filepath => fs.existsSync(filepath))
            files = util.transformFixedData(files,0,util.sortSize)
    
            mainWindow.webContents.send("directoryOpen", files);
        })
    }else 
    if (fileGlobal) {
        openfile()
    }
})

const moveFile = (bol, dest, onlyCopy, data) =>{
    if(process.env.FixFiles){
        console.log("##MOVEFILE",dest,data.filter(f => f.checked === bol).map(f => f.path).join(","));
        
        return;
    }
    data.filter(f => f.checked === bol).forEach(media => {
        // let completeDestine = path.join(path.dirname(media.path), dest);
        let completeDestine = path.join(fileGlobal, dest);
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
        // mainWindow.ipcMain.send("delete", media)
    });
}
const util = require("./util")
const transformData = util.transformData
var actualSort = util.sortSize
const openfile = () => {
    mainWindow.title = `Get Images in ${fileGlobal}`


    fs.readdir(fileGlobal, "utf8", (err, data) => {
        if (err) console.error(err);
        else {
            console.log(`Get Images in ${fileGlobal}`, "files", data.length);
            mainWindow.webContents.send("directoryOpen",
                transformData(data, fileGlobal, 0,actualSort)
            );
        }
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
        if (err) console.error(err);
        let qtdFiles = data.map(item => path.join(folderPath, item)).filter(item => fs.statSync(item).isFile()).length
        data.map(item => path.join(folderPath, item)).filter(item => fs.statSync(item).isDirectory()).forEach(item => openfileRecursive(item))

        if (qtdFiles > 0)
            mainWindow.webContents.send("loadMedias",
                transformData(data, folderPath, counter,actualSort)
            );
        counter += qtdFiles
    })
}

const sortByName =  async () =>{actualSort=util.sortName; openfile()}    //mainWindow.webContents.send("sort","sortByName")
const sortBySize =  async () =>{actualSort=util.sortSize; openfile()}    //mainWindow.webContents.send("sort","sortBySize")
const sortByFolder =  async () =>{actualSort=util.sortFolder; openfile()}    //mainWindow.webContents.send("sort","sortByFolder")