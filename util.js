const path = require("path");
const fs = require("fs");


const sortSize = (a, b) => b.size - a.size
const sortName = (a, b) => path.basename(b.item) - path.basename(a.item)
const sortFolder = (a, b) => b.size - a.size
const noSort = (a,b) => 0

module.exports = {
    transformData: (data, folderOpened, counter, sortFiles) => transformData(data, folderOpened, counter, sortFiles),
    transformFixedData:(data, counter, sortFiles) => transformFixedData(data, counter, sortFiles),
    sortSize: sortSize, sortName: sortName, sortFolder: sortFolder,noSort:noSort,
}



const mime = require('mime-types');
const { execSync } = require('child_process');

const transformData = (data, folderOpened, counter, sortFiles = sortSize) => {
    return transformFixedData(data.map(item => path.join(folderOpened, item)), counter, sortFiles)

}


const transformFixedData = (data, counter, sortFiles = sortSize) => {

    return data.filter(filepath => fs.statSync(filepath)
        .isFile()
    )
        .map(item => {
            return { item: item, mime: mime.lookup(item), fileName: item, size: fs.statSync(item).size, id: counter++ }
        })
        .filter(item => {
            const mime_type = item.mime
            return mime_type && (mime_type.includes('image') || mime_type.includes('video'))
        })
        .sort(sortFiles)
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

}