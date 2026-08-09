const path = require("path");
const fs = require("fs");

const mime = require('mime-types');
const thumbnails = require("./thumbnails/ThumbnailService");
const cache = require("./thumbnails/cache");
const { hashFor } = cache;
const videoFrames = require("./compareImg/videoFrames");
const MediaStore = require("./mediaDb/MediaStore");
const { backfillContentMd5 } = require("./mediaDb/backfill");

const kindFor = (itemMime) => {
    if (itemMime && itemMime.includes('gif')) return 'gif';
    if (itemMime && itemMime.includes('video')) return 'video';
    return 'image';
};

const upsertMediaSafe = (item) => {
    // Cross-folder "fake" items from compareImg/dbImport.js live outside the
    // opened folder and have no business in THIS folder's media table - a
    // row here would make the content-MD5 backfill read an external file in
    // full on every subsequent open of the actual folder.
    if (item.imported) return;
    try {
        MediaStore.upsertMedia({
            id: item.id,
            localPath: item.item,
            filename: item.filename,
            mime: item.mime,
            kind: item.kind,
            size: item.size,
            mtimeMs: item.mtimeMs,
            hasAudio: item.hasAudio,
            thumbPath: item.kind === 'image' ? null : item.fileName,
        });
    } catch (error) {
        console.error("upsertMedia failed for", item.item, "-", error.message);
    }
};

// onDone fires once every video's thumbnail has been generated and sent —
// videos are added one at a time (each awaits its own thumbnail), so the
// caller has no other way to know the grid is still being populated.
//
// extraFields is stamped onto every produced item — used by the database
// import flow to mark cross-folder "fake" items ({ imported: true }) while
// still reusing this same thumbnail/metadata pipeline. Pass an empty
// folderOpened to treat data as absolute paths (import items live outside
// the opened folder).
const transformDataStreaming = async (data, folderOpened, onImages, onVideo, onDone, extraFields = {}) => {
    const allPaths = folderOpened ? data.map(item => path.join(folderOpened, item)) : data;

    const withMeta = allPaths
        .map(item => { try { return { item, stat: fs.statSync(item) }; } catch { return { item, stat: null }; } })
        .filter(({ stat }) => stat && stat.isFile())
        .map(({ item, stat }) => {
            const itemMime = mime.lookup(item);
            return {
                item,
                mime: itemMime,
                fileName: item,
                filename: path.basename(item),
                size: stat.size,
                mtimeMs: stat.mtimeMs,
                hasAudio: false,
                kind: kindFor(itemMime),
                // MD5 of the absolute path: stable across reloads (unlike a load-order
                // counter), so it survives a re-scan and stays valid as the key
                // compareImg's duplicate index stores duplicate-group membership under.
                id: hashFor(item),
                ...extraFields
            };
        })
        .filter(item => item.mime && (item.mime.includes('image') || item.mime.includes('video')));

    // GIFs are many-frame media like video (see compareImg/mediaIndexer.js),
    // not a single still like a plain image, so they're routed through the
    // thumbnail pipeline instead of being emitted as-is.
    const images = withMeta.filter(i => i.kind === 'image');
    const framed = withMeta.filter(i => i.kind === 'video' || i.kind === 'gif');

    // Batched indexed lookup against the media table so a video/gif whose
    // thumbnail is already cached can skip the slow per-item ffmpeg loop
    // below entirely. Any DB failure here must never stop the folder from
    // opening - fall through to the slow path for every framed item.
    let cached = new Map();
    try {
        MediaStore.ensureReady();
        cached = MediaStore.findMediaByIds(framed.map(i => i.id));
    } catch (error) {
        console.error("transformDataStreaming: media DB lookup failed, falling back to slow path:", error.message);
        cached = new Map();
    }

    const ready = [];
    const pending = [];
    for (const item of framed) {
        const row = cached.get(item.id);
        const thumbPath = row && row.contentMd5 ? cache.thumbnailPathFor(item.item, row.contentMd5) : null;
        const isReady = Boolean(row)
            && row.size === item.size
            && row.mtimeMs === item.mtimeMs
            && Boolean(row.contentMd5)
            && Boolean(thumbPath)
            && fs.existsSync(thumbPath);
        if (isReady) {
            item.fileName = thumbPath;
            item.hasAudio = Boolean(row.hasAudio);
            item.contentMd5 = row.contentMd5;
            ready.push(item);
        } else {
            pending.push(item);
        }
    }

    // onImages maps to the "directoryOpen" channel which REPLACES the grid
    // (populateArray assigns, it does not append) - it may only be called
    // once per load, so the already-cached items are folded into this single
    // call instead of trickling in through onVideo like the slow ones.
    onImages(images.concat(ready));

    for (const item of pending) {
        const row = cached.get(item.id);
        item.fileName = await thumbnails.getThumbnail(item.item, row && row.contentMd5);
        item.hasAudio = await videoFrames.hasAudio(item.item);
        onVideo(item);
        upsertMediaSafe(item);
    }

    for (const item of images) {
        upsertMediaSafe(item);
    }

    if (onDone) onDone();

    // Never blocks the load path: content hashing happens off to the side so
    // subsequent loads can read the memoised contentMd5 instead of touching
    // file bytes again.
    backfillContentMd5();
};

const transformFixedData = (data) => {
    const result = data.filter(filepath => fs.statSync(filepath)
        .isFile()
    )
        .map(item => {
            const itemMime = mime.lookup(item);
            return {
                item: item,
                mime: itemMime,
                fileName: item,
                filename: path.basename(item),
                size: fs.statSync(item).size,
                hasAudio: false,
                kind: kindFor(itemMime),
                id: hashFor(item)
            }
        })
        .filter(item => {
            const mime_type = item.mime
            return mime_type && (mime_type.includes('image') || mime_type.includes('video'))
        })
        .map(item => {
            item.hash = hashFor(item.item);
            if (item.kind === 'video' || item.kind === 'gif') {
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
