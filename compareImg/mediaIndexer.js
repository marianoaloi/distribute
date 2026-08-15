const compareImgStore = require("./HashStore");
const computePool = require("./computePool");
const videoFrames = require("./videoFrames");

// pixelSourcePath: what to read pixel data from (the frame file for videos, the
// media file itself for images). mediaId: the related media row's id - items
// no longer store localPath/kind themselves, those are read through the
// media x item relation instead (see HashStore.js's items.mediaId).
const indexUnit = async (id, pixelSourcePath, mediaId, framePosition) => {
    const existing = compareImgStore.getItem(id);
    if (existing) return;

    // Pixel hashing runs in a worker-thread pool so it doesn't block the
    // Electron main process/UI and multiple items' hashing runs truly in
    // parallel across cores.
    const { baseMd5, grey } = await computePool.compute(pixelSourcePath);

    const metadata = {
        mediaId,
        framePosition: framePosition || "",
        futurePosition: -1,
        baseMd5,
        // Raw cropped/greyscale pixel buffer, stored so duplicateFinder.js
        // can do a real similarity comparison (mean pixel difference) instead
        // of hash equality - see HashStore.js's baseGrey column.
        baseGrey: Buffer.from(grey),
    };

    compareImgStore.upsertItem({ id, metadata });
};

const indexImage = async (mediaItem) => {
    const localPath = mediaItem.item;
    if (!mediaItem.contentMd5) return;
    try {
        await indexUnit(mediaItem.contentMd5, localPath, mediaItem.id, "");
    } catch (error) {
        console.error(`compareImg: failed to index image ${localPath}:`, error.message);
    }
};

// Frame positions are fixed labels (not duration-derived), so we can check
// whether a video's frames are already indexed without probing it via ffmpeg.
const videoAlreadyIndexed = async (mediaItem) => {
    const baseId = mediaItem.contentMd5;
    try {
        for (const position of videoFrames.FRAME_POSITIONS) {
            if (!compareImgStore.getItem(`${baseId}_${position}`)) return false;
        }
        return true;
    } catch (error) {
        console.error(`compareImg: failed to check index for ${mediaItem.item}:`, error.message);
        return false;
    }
};

const indexVideo = async (mediaItem) => {
    const localPath = mediaItem.item;
    if (!mediaItem.contentMd5) return;
    if (await videoAlreadyIndexed(mediaItem)) return;

    const frames = await videoFrames.extractFrames(localPath).catch(error => {
        console.error(`compareImg: frame extraction failed for ${localPath}:`, error.message);
        return [];
    });

    for (const frame of frames) {
        const id = `${mediaItem.contentMd5}_${frame.position}`;
        try {
            await indexUnit(id, frame.path, mediaItem.id, frame.position);
        } catch (error) {
            console.error(`compareImg: failed to index video frame ${frame.path}:`, error.message);
        }
    }
};

// Media items are CPU/IO bound one at a time (ffmpeg spawn, image hashing)
// but independent of each other, so process several concurrently instead of
// one full item at a time. HashStore.upsertItem is synchronous (no internal
// await), so concurrent writes can't interleave; isolates per-item failures
// so one bad file doesn't stop the batch.
const ITEM_CONCURRENCY = 6;

// onProgress(processed, total), if given, fires after each media item (image,
// or video with all its frames) finishes — lets a caller surface progress
// since indexing a real library can take minutes (ffmpeg + hashing).
const indexMediaBackground = async (mediaItems, onProgress) => {
    compareImgStore.ensureReady();
    const total = mediaItems.length;
    let processed = 0;

    let cursor = 0;
    const runWorker = async () => {
        while (cursor < mediaItems.length) {
            const mediaItem = mediaItems[cursor++];
            if (mediaItem.mime && mediaItem.mime.includes("gif")) {
                // A gif is many frames like a video, not a single still like
                // an image - route it through indexVideo before the generic
                // image/video mime checks below.
                await indexVideo(mediaItem);
            } else if (mediaItem.mime && mediaItem.mime.includes("video")) {
                await indexVideo(mediaItem);
            } else if (mediaItem.mime && mediaItem.mime.includes("image")) {
                await indexImage(mediaItem);
            }
            processed++;
            if (onProgress) onProgress(processed, total);
        }
    };

    const workerCount = Math.min(ITEM_CONCURRENCY, mediaItems.length);
    await Promise.all(Array.from({ length: workerCount }, runWorker));
};

module.exports = {
    indexMediaBackground,
};
