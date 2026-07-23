const compareImgStore = require("./VectorStore");
const imageTransform = require("./imageTransform");
const imageEmbedding = require("./imageEmbedding");
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

    const [{ baseMd5, blurMd5 }, vector] = await Promise.all([
        imageTransform.md5sFor(pixelSourcePath),
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

    await compareImgStore.index.upsertItem({ id, vector, metadata });
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
    for (const position of videoFrames.FRAME_POSITIONS) {
        if (!(await compareImgStore.index.getItem(`${baseId}_${position}`))) return false;
    }
    return true;
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

// Fire-and-forget friendly: sequential (single-threaded main process), isolates
// per-item failures so one bad file doesn't stop the rest of the batch.
const indexMediaBackground = async (mediaItems) => {
    await compareImgStore.ensureReady();
    for (const mediaItem of mediaItems) {
        if (mediaItem.mime && mediaItem.mime.includes("video")) {
            await indexVideo(mediaItem);
        } else if (mediaItem.mime && mediaItem.mime.includes("image")) {
            await indexImage(mediaItem);
        }
    }
};

module.exports = {
    indexMediaBackground,
};
