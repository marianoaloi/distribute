const path = require("path");
const fs = require("fs");

const mime = require('mime-types');
const thumbnails = require("./thumbnails/ThumbnailService");
const { hashFor } = require("./thumbnails/cache");

const sortSize = (a, b) => b.size - a.size
const sortName = (a, b) => path.basename(a.item).localeCompare(path.basename(b.item))
const sortFolder = (a, b) => path.dirname(a.item).localeCompare(path.dirname(b.item))
const noSort = (a, b) => 0

const transformData = (data, folderOpened, counter, sortFiles = sortSize) => {
    return transformFixedData(data.map(item => path.join(folderOpened, item)), counter, sortFiles)

}

// onDone fires once every video's thumbnail has been generated and sent —
// videos are added one at a time (each awaits its own thumbnail), so the
// caller has no other way to know the grid is still being populated.
const transformDataStreaming = async (data, folderOpened, counter, sortFiles = sortSize, onImages, onVideo, onDone) => {
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
        item.fileName = await thumbnails.getThumbnail(item.item);
        onVideo(item);
    }

    if (onDone) onDone();
};

const transformFixedData = (data, counter, sortFiles = sortSize) => {
    const result = data.filter(filepath => fs.statSync(filepath)
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
            item.hash = hashFor(item.item);
            if (item.mime && item.mime.includes('video')) {
                item.fileName = thumbnails.getThumbnailSync(item.item);
            }
            return item

        })

    return result;
}

module.exports = {
    transformData,
    transformFixedData,
    transformDataStreaming,
    sortSize: sortSize, sortName: sortName, sortFolder: sortFolder, noSort: noSort,
}
