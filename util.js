module.exports = {
    transformData: (data, folderOpened, counter) => transformData(data, folderOpened, counter)
}


const path = require("path");
const fs = require("fs");

const mime = require('mime-types');
const { execSync } = require('child_process');

const transformData = (data, folderOpened, counter) => {
    return data.map(item => path.join(folderOpened, item))
        .filter(item => fs.statSync(item)
            .isFile()
        )
        .map(item => {
            return { item: item, mime: mime.lookup(item), fileName: item, size: fs.statSync(item).size, id: counter++ }
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
}