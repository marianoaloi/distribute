const path = require("path");
const fs = require("fs");

const os = require('os');
const crypto = require('crypto');


const sortSize = (a, b) => b.size - a.size
const sortName = (a, b) => path.basename(b.item) - path.basename(a.item)
const sortFolder = (a, b) => b.size - a.size
const noSort = (a, b) => 0





const mime = require('mime-types');
const { execSync, execFileSync, execFile } = require('child_process');
const { quote } = require('shell-quote');
const { dirCache } = require("./DirectorioCache");

const transformData = (data, folderOpened, counter, sortFiles = sortSize) => {
    return transformFixedData(data.map(item => path.join(folderOpened, item)), counter, sortFiles)

}

const execCommandFFMPEG = (input, output) => {
    try {
        execFileSync('ffmpegthumbnailer', ['-s300', '-i', input, '-o', output, '-f'], { encoding: 'UTF-8' })
    } catch (error) {
        console.error("FFMPEG error", error.message, "\nCommand: ", `ffmpegthumbnailer -s300 -i "${input}" -o "${output}" -f `);
        throw error;
    }
}

const execCommandFFMPEGAsync = (input, output) => new Promise((resolve, reject) => {
    execFile('ffmpegthumbnailer', ['-s300', '-i', input, '-o', output, '-f'], { encoding: 'UTF-8' }, (error) => {
        if (error) {
            console.error("FFMPEG async error", error.message);
            reject(error);
        } else {
            resolve();
        }
    });
});

const transformDataStreaming = async (data, folderOpened, counter, sortFiles = sortSize, onImages, onVideo) => {
    const allPaths = data.map(item => path.join(folderOpened, item));

    const withMeta = allPaths
        .filter(filepath => { try { return fs.statSync(filepath).isFile(); } catch { return false; } })
        .map(item => ({
            item,
            mime: mime.lookup(item),
            fileName: item,
            size: (() => { try { return fs.statSync(item).size; } catch { return 0; } })(),
            id: counter++
        }))
        .filter(item => item.mime && (item.mime.includes('image') || item.mime.includes('video')));

    const images = withMeta.filter(i => i.mime.includes('image')).sort(sortFiles);
    const videos = withMeta.filter(i => i.mime.includes('video')).sort(sortFiles);

    onImages(images);

    for (const item of videos) {
        const hashName = crypto.createHash('md5').update(item.item).digest('hex');
        const fileName = path.join(dirCache, 'tmp', 'ffmpeg', `${hashName}.jpeg`);
        item.fileName = fileName;

        if (!fs.existsSync(fileName)) {
            const input = item.item;
            try {
                await execCommandFFMPEGAsync(input, fileName);
                onVideo(item);
            } catch {
                try {
                    const ext = path.extname(input);
                    const tmp = path.join(dirCache, hashName + ext);
                    fs.linkSync(input, tmp);
                    await execCommandFFMPEGAsync(tmp, fileName);
                    fs.unlinkSync(tmp);
                    console.log("Thumbnail created using temporary link for", item.item);
                    onVideo(item);
                } catch {
                    console.error("Failed to create thumbnail for", item.item);
                }
            }
        } else {
            onVideo(item);
        }
    }
};

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

            const hashName = crypto.createHash('md5').update(item.item).digest('hex');
            item.hash = hashName;
            const mime_type = item.mime
            if (mime_type && mime_type.includes('video')) {
                // item.item = item.item.trim()
                const fileName = `${path.join(dirCache, "tmp/ffmpeg")}\\${hashName}.jpeg`
                item.fileName = fileName
                if (!fs.existsSync(fileName)) {
                    const input = item.item;
                    try {
                        //`ffmpegthumbnailer -s300 -i "${item.item}" -o "${fileName}" -f `
                        // execSync(`chcp 65001 >nul && ffmpegthumbnailer -s300 -i "${item.item}" -o "${fileName}" -f `, {'encoding': 'UTF-8'})
                        execCommandFFMPEG(input, fileName)
                    } catch (error) {
                        try {
                            const ext = path.extname(input);
                            const tmp = path.join(dirCache, hashName + ext);
                            fs.linkSync(input, tmp);
                            execCommandFFMPEG(tmp, fileName)
                            fs.unlinkSync(tmp);
                            console.log("Thumbnail created using temporary link for", item.item);
                        } catch (error) {
                            return undefined
                        }
                        return undefined
                    }
                }

            }
            return item

        })

}

module.exports = {
    transformData,
    transformFixedData,
    transformDataStreaming,
    sortSize: sortSize, sortName: sortName, sortFolder: sortFolder, noSort: noSort,
}