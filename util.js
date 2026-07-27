const path = require("path");
const fs = require("fs");

const mime = require('mime-types');
const thumbnails = require("./thumbnails/ThumbnailService");
const { hashFor } = require("./thumbnails/cache");
const videoFrames = require("./compareImg/videoFrames");

// onDone fires once every video's thumbnail has been generated and sent —
// videos are added one at a time (each awaits its own thumbnail), so the
// caller has no other way to know the grid is still being populated.
const transformDataStreaming = async (data, folderOpened, onImages, onVideo, onDone) => {
    const allPaths = data.map(item => path.join(folderOpened, item));

    const withMeta = allPaths
        .filter(filepath => { try { return fs.statSync(filepath).isFile(); } catch { return false; } })
        .map(item => ({
            item,
            mime: mime.lookup(item),
            fileName: item,
            filename: path.basename(item),
            size: (() => { try { return fs.statSync(item).size; } catch { return 0; } })(),
            hasAudio: false,
            // MD5 of the absolute path: stable across reloads (unlike a load-order
            // counter), so it survives a re-scan and stays valid as the key
            // compareImg's duplicate index stores duplicate-group membership under.
            id: hashFor(item)
        }))
        .filter(item => item.mime && (item.mime.includes('image') || item.mime.includes('video')));

    const images = withMeta.filter(i => i.mime.includes('image'));
    const videos = withMeta.filter(i => i.mime.includes('video'));

    onImages(images);

    for (const item of videos) {
        item.fileName = await thumbnails.getThumbnail(item.item);
        item.hasAudio = await videoFrames.hasAudio(item.item);
        onVideo(item);
    }

    if (onDone) onDone();
};

const transformFixedData = (data) => {
    const result = data.filter(filepath => fs.statSync(filepath)
        .isFile()
    )
        .map(item => {
            return {
                item: item,
                mime: mime.lookup(item),
                fileName: item,
                filename: path.basename(item),
                size: fs.statSync(item).size,
                hasAudio: false,
                id: hashFor(item)
            }
        })
        .filter(item => {
            const mime_type = item.mime
            return mime_type && (mime_type.includes('image') || mime_type.includes('video'))
        })
        .map(item => {
            item.hash = hashFor(item.item);
            if (item.mime && item.mime.includes('video')) {
                item.fileName = thumbnails.getThumbnailSync(item.item);
                item.hasAudio = videoFrames.hasAudioSync(item.item);
            }
            return item

        })

    return result;
}

const transformData = (data, folderOpened) => {
    return transformFixedData(data.map(item => path.join(folderOpened, item)))
}

module.exports = {
    transformData,
    transformFixedData,
    transformDataStreaming,
}
