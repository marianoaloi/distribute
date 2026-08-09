const compareImgStore = require("./HashStore");
const computePool = require("./computePool");
const videoFrames = require("./videoFrames");
const { hashFor } = require("../thumbnails/cache");

// pixelSourcePath: what to read pixel data from (the frame file for videos, the
// media file itself for images). metadataLocalPath: what to record as the
// media's own location, always the source file the user actually has on disk.
const indexUnit = async (id, pixelSourcePath, metadataLocalPath, kind, framePosition, actualPosition) => {
    const existing = compareImgStore.getItem(id);
    if (existing) return;

    // Pixel hashing runs in a worker-thread pool so it doesn't block the
    // Electron main process/UI and multiple items' hashing runs truly in
    // parallel across cores.
    const { baseMd5, grey } = await computePool.compute(pixelSourcePath);

    const metadata = {
        localPath: metadataLocalPath,
        kind,
        framePosition: framePosition || "",
        actualPosition,
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
    const id = hashFor(localPath);
    try {
        await indexUnit(id, localPath, localPath, "image", "", mediaItem.id);
    } catch (error) {
        console.error(`compareImg: failed to index image ${localPath}:`, error.message);
    }
};

// Frame positions are fixed labels (not duration-derived), so we can check
// whether a video's frames are already indexed without probing it via ffmpeg.
const videoAlreadyIndexed = async (localPath) => {
    const baseId = hashFor(localPath);
    try {
        for (const position of videoFrames.FRAME_POSITIONS) {
            if (!compareImgStore.getItem(`${baseId}_${position}`)) return false;
        }
        return true;
    } catch (error) {
        console.error(`compareImg: failed to check index for ${localPath}:`, error.message);
        return false;
    }
};

const indexVideo = async (mediaItem) => {
    const localPath = mediaItem.item;
    if (await videoAlreadyIndexed(localPath)) return;

    const frames = await videoFrames.extractFrames(localPath).catch(error => {
        console.error(`compareImg: frame extraction failed for ${localPath}:`, error.message);
        return [];
    });

    for (const frame of frames) {
        const id = `${hashFor(localPath)}_${frame.position}`;
        try {
            await indexUnit(id, frame.path, localPath, "video", frame.position, mediaItem.id);
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
