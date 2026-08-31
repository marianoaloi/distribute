import * as compareImgStore from "./HashStore";
import { pixelHashFor } from "./pixelHash";
import { extractFrames, FRAME_POSITIONS } from "./videoFrames";
import { memoryAwareLimit, TASK_MEMORY_ESTIMATE } from "../system/resourceLimits";

// Shape accepted by indexImage/indexVideo/indexMediaBackground - built by
// app.js's rebuildIndex handler from MediaStore rows before calling in here.
export interface IndexableMediaItem {
    item: string;
    mime?: string | null;
    kind?: string;
    contentMd5?: string | null;
    id: string;
}

// pixelSourcePath: what to read pixel data from (the frame file for videos, the
// media file itself for images). mediaId: the media row this item belongs to
// - id already embeds it (see itemBaseId below), but linkItemMedia still
// needs it explicitly to populate the media_item join table.
const indexUnit = async (
    id: string,
    pixelSourcePath: string,
    mediaId: string,
    framePosition: string,
    framePositionSeconds: number | null = null,
): Promise<void> => {
    compareImgStore.linkItemMedia(id, mediaId);

    const existing = compareImgStore.getItem(id);
    if (existing) return;

    // Logged at start, not just on failure: this line is what makes the
    // file being worked on identifiable in real time rather than only after
    // the fact (see git history around indexRebuildProgress stalling
    // silently).
    console.log(`compareImg: hashing ${pixelSourcePath}`);

    // Runs in a short-lived ffmpeg child process, so the decode never
    // touches the Electron main thread and its memory is the OS's to
    // reclaim - see pixelHash.ts for why that replaced a worker pool.
    const { baseMd5, baseGrey } = await pixelHashFor(pixelSourcePath);

    const metadata = {
        framePosition: framePosition || "",
        framePositionSeconds,
        baseMd5,
        // Raw cropped/greyscale pixel buffer, stored so duplicateFinder.js
        // can do a real similarity comparison (mean pixel difference) instead
        // of hash equality - see HashStore.js's baseGrey column.
        baseGrey,
    };

    compareImgStore.upsertItem({ id, metadata });
};

// Item ids are now media.contentMd5 concatenated with media.id, not bare
// contentMd5 - each media gets its own item(s) instead of sharing one item
// across every media with byte-identical content.
const itemBaseId = (mediaItem: IndexableMediaItem): string => `${mediaItem.id}`;

const indexImage = async (mediaItem: IndexableMediaItem): Promise<void> => {
    const localPath = mediaItem.item;
    if (!mediaItem.contentMd5) return;
    try {
        await indexUnit(itemBaseId(mediaItem), localPath, mediaItem.id, "");
    } catch (error) {
        console.error(`compareImg: failed to index image ${localPath}:`, (error as Error).message);
    }
};

// Frame positions are fixed labels (not duration-derived), so we can check
// whether a video's frames are already indexed without probing it via ffmpeg.
const videoAlreadyIndexed = async (mediaItem: IndexableMediaItem): Promise<boolean> => {
    const baseId = itemBaseId(mediaItem);
    try {
        for (const position of FRAME_POSITIONS) {
            if (!compareImgStore.getItem(`${baseId}_${position}`)) return false;
        }
        return true;
    } catch (error) {
        console.error(`compareImg: failed to check index for ${mediaItem.item}:`, (error as Error).message);
        return false;
    }
};

const indexVideo = async (mediaItem: IndexableMediaItem): Promise<void> => {
    const localPath = mediaItem.item;
    if (!mediaItem.contentMd5) return;
    const baseId = itemBaseId(mediaItem);
    if (await videoAlreadyIndexed(mediaItem)) {
        // This media's own items already exist from an earlier indexing pass
        // (e.g. a previous rebuild) - no ffmpeg/hashing needed, but THIS
        // media still needs its own link into media_item or it never shows
        // up as a member of the duplicate group.
        for (const position of FRAME_POSITIONS) {
            compareImgStore.linkItemMedia(`${baseId}_${position}`, mediaItem.id);
        }
        return;
    }

    // See indexUnit's matching log line - extractFrames spawns ffmpeg
    // (now timeout-bounded, see videoFrames.js) and was previously the
    // other silent place a run could stall on with no indication which
    // file it was working on.
    console.log(`compareImg: extracting frames for ${localPath}`);

    const frames = await extractFrames(localPath).catch(error => {
        console.error(`compareImg: frame extraction failed for ${localPath}:`, (error as Error).message);
        return [];
    });

    for (const frame of frames) {
        const id = `${baseId}_${frame.position}`;
        try {
            await indexUnit(id, frame.path, mediaItem.id, frame.position, frame.seconds ?? null);
        } catch (error) {
            console.error(`compareImg: failed to index video frame ${frame.path}:`, (error as Error).message);
        }
    }
};

// Media items are CPU/IO bound one at a time (ffmpeg spawn, image hashing)
// but independent of each other, so process several concurrently instead of
// one full item at a time. HashStore.upsertItem is synchronous (no internal
// await), so concurrent writes can't interleave; isolates per-item failures
// so one bad file doesn't stop the batch. This is the ceiling free RAM is
// allowed to pull down from (see resourceLimits.ts) - each in-flight item
// mostly delegates its real memory cost downstream to extractFrames
// (separately memory-gated; pixelHash costs a few MB in a short-lived
// child process and needs no gating), but still holds its own slice of
// state while waiting.
const ITEM_CONCURRENCY_CEILING = 6;

// onProgress(processed, total), if given, fires after each media item (image,
// or video with all its frames) finishes — lets a caller surface progress
// since indexing a real library can take minutes (ffmpeg + hashing).
export const indexMediaBackground = async (
    mediaItems: IndexableMediaItem[],
    onProgress?: (processed: number, total: number) => void,
): Promise<void> => {
    compareImgStore.ensureReady();
    const total = mediaItems.length;
    let processed = 0;

    let cursor = 0;
    const runWorker = async (): Promise<void> => {
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

    // Resolved live for this run rather than once at module load, so a
    // batch kicked off on a loaded machine starts throttled instead of
    // discovering the hard way (see videoFrames' timeouts).
    const itemConcurrency = memoryAwareLimit(ITEM_CONCURRENCY_CEILING, TASK_MEMORY_ESTIMATE.indexingItem);
    const workerCount = Math.min(itemConcurrency, mediaItems.length);
    await Promise.all(Array.from({ length: workerCount }, runWorker));
};
