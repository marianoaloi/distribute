const fs = require("fs");

var parent;
module.exports = {
    menu: (parentIn) => {
        parent = parentIn
        return [
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

        ]
    }
}


const zoomImg = async (zoom) => {
    parent.mainWindow.webContents.send("zoom", zoom)
}

const loadFolders = async () => {
    fs.readdir(parent.fileGlobal, { encoding: "utf8", withFileTypes: true }, (err, data) => {
        if (err) console.error(err);
        else {
            parent.mainWindow.webContents.send("menuOpen",

                data
                    .filter(d => d.isDirectory())
                    .map(d => d.name)
            );

        }
    }
    )

}

const { dialog } = require("electron");

const loadRecursive = async () => {

    let options = {
        properties: ["openDirectory", 'promptToCreate'],
        title: "Open folder recursive to choice medias",
    };
    if (parent.fileGlobal) options["defaultPath"] = parent.fileGlobal;
    dialog.showOpenDialog(options).then(file => {
        if (!file.canceled) {
            openfile(file.filePaths[0]);

            parent.mainWindow.title = `Get Images in ${parent.fileGlobal} recursive in ${file.filePaths[0]}`
        }
    }).catch(err => {
        console.error(err);
    });
}
const path = require("path");

const transformData = require("./util").transformData
var counter = 0
const openfile = (folderPath) => {


    fs.readdir(folderPath, "utf8", (err, data) => {
        if (err) console.error(err);
        let qtdFiles = data.map(item => path.join(folderPath, item)).filter(item => fs.statSync(item).isFile()).length
        data.map(item => path.join(folderPath, item)).filter(item => fs.statSync(item).isDirectory()).forEach(item => openfile(item))

        if (qtdFiles > 0)
            parent.mainWindow.webContents.send("loadMedias",
                transformData(data, folderPath, counter).sort((a, b) => a.id - b.id, { id: 0 })
            );
        counter += qtdFiles
    })
}