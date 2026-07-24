const compareImgStore = require("./VectorStore");
const imageTransform = require("./imageTransform");
const imageEmbedding = require("./imageEmbedding");
const computePool = require("./computePool");
const videoFrames = require("./videoFrames");
const { hashFor } = require("../thumbnails/cache");

// vectra metadata values must be number | string | boolean, so the blur MD5s
// are stored as flat fields (one per configured blur level) instead of an array
const blurFieldName = (level) => `blur_${level}`;

// pixelSourcePath: what to read pixel data from (the frame file for videos, the
// media file itself for images). metadataLocalPath: what to record as the
// media's own location, always the source file the user actually has on disk.
const indexUnit = async (id, pixelSourcePath, metadataLocalPath, kind, framePosition, actualPosition) => {
    const existing = await compareImgStore.index.getItem(id);
    if (existing) return;

    // Pixel hashing runs in a worker-thread pool so it doesn't block the
    // Electron main process/UI and multiple items' hashing runs truly in
    // parallel across cores. CLIP embedding stays on the main thread (see
    // frameWorker.js for why); the two still run concurrently per item.
    const [{ baseMd5, blurMd5 }, vector] = await Promise.all([
        computePool.compute(pixelSourcePath),
        imageEmbedding.embed(pixelSourcePath),
    ]);

    const metadata = {
        localPath: metadataLocalPath,
        kind,
        framePosition: framePosition || "",
        actualPosition,
        futurePosition: -1,
        baseMd5,
    };
    imageTransform.BLUR_LEVELS.forEach((level, idx) => {
        metadata[blurFieldName(level)] = blurMd5[idx];
    });

    await compareImgStore.upsertItem({ id, vector, metadata });
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
            if (!(await compareImgStore.index.getItem(`${baseId}_${position}`))) return false;
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

// Media items are CPU/IO bound one at a time (ffmpeg spawn, image hashing,
// CLIP embedding) but independent of each other, so process several
// concurrently instead of one full item at a time. Index writes are
// serialized separately (see VectorStore.upsertItem) so this concurrency is
// safe. Isolates per-item failures so one bad file doesn't stop the batch.
const ITEM_CONCURRENCY = 6;

// onProgress(processed, total), if given, fires after each media item (image,
// or video with all its frames) finishes — lets a caller surface progress
// since indexing a real library can take minutes (model warm-up + ffmpeg).
const indexMediaBackground = async (mediaItems, onProgress) => {
    await compareImgStore.ensureReady();
    const total = mediaItems.length;
    let processed = 0;

    let cursor = 0;
    const runWorker = async () => {
        while (cursor < mediaItems.length) {
            const mediaItem = mediaItems[cursor++];
            if (mediaItem.mime && mediaItem.mime.includes("video")) {
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
