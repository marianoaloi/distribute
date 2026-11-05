
import fs from "fs";
import * as MediaStore from "../mediaDb/MediaStore";
import { DetectionBox, DetectMediaRef } from "../types/domain";
import * as mediaIndexer from "../compareImg/mediaIndexer";
import * as inFlight from "../system/inFlight";
import { countMedia, inTransaction, itemRefsForMedia, listMediaPage, type PagedMediaRow } from "../mediaDb/mediaPages";
import { forEachPage } from "../mediaDb/paging";

// Media per page of the detection pass.
export const DETECT_PAGE_SIZE = 200;

export interface DetectionFoundEvent {
    id: string;
    boxes: DetectionBox[];
    classes: string[];
    classScores: Record<string, { min: number; max: number }>;
    error?: string;
}

// Where per-media results go: app.ts forwards them to the renderer's
// "detectionFound"/"detectionProgress" IPC channels; the headless CLI just
// counts them. Keeps this module free of any BrowserWindow dependency.
export interface DetectionSink {
    found(event: DetectionFoundEvent): void;
    progress(p: { processed: number; total: number }): void;
}

// The part of objectDetection/onnxDetector this loop needs - injectable so a
// caller can substitute a fake detector.
export interface DetectorLike {
    getModelPath(): string | null;
    detect(imagePath: string): Promise<DetectionBox[]>;
}

// onProgress mirrors sink.progress but is only forwarded when a caller passes
// it - app.ts wires it to pipeline/PipelineRun.js's "detect" stage when this
// run is part of the loadSuperRecursive chain, and leaves it unset for a
// plain manual run (which already has its own "detecting" progress bar via
// the "detectionProgress" IPC event).
// shouldStop is polled before each media is picked up (a callback, not a
// boolean, so a stop requested mid-run actually reaches the loop).
export interface DetectionPassStats {
    // Media skipped because every item was already detected with this model.
    alreadyDone: number;
    // Video/GIF media with no extracted frames (nothing to detect on).
    withoutFrames: number;
    // The first FAILED_PATHS_CAP media files whose detection failed.
    failedPaths: string[];
}

export const FAILED_PATHS_CAP = 100;

export const processMediaToDetections = async (sink: DetectionSink, onnxDetector: DetectorLike, classNames: string[], shouldStop: () => boolean, onProgress?: (processed: number, total: number) => void): Promise<DetectionPassStats> => {


    let processed = 0;

    MediaStore.ensureReady();
    const modelPathId = MediaStore.getOrCreateModelPath(onnxDetector.getModelPath() as string);
    const classList = MediaStore.classListKey(classNames);
    // Media count - progress is per media (already-detected ones are counted
    // as they are skipped, one page at a time).
    const total = countMedia();

    // Done-check per ITEM: a video/GIF has one item per extracted frame and
    // its itemId differs from the media id (checking the media id never
    // matched them, so every video was re-detected on every run). An item
    // counts as done only when it was detected by this same model against
    // this same class list - switching .maloi model re-detects.
    const itemKey = (media: DetectMediaRef): string => media.itemId || media.id;

    // Same continuous worker-pool pattern as compareImg/mediaIndexer.ts's
    // indexMediaBackground (ITEM_CONCURRENCY): a fixed number of workers
    // pull the next media off a shared cursor as soon as they finish,
    // instead of waiting for a whole synchronized batch to drain - the
    // awaited parts (file read, JPEG decode, letterbox, session.run
    // scheduling) overlap instead of queueing behind each other. The
    // native inference itself still runs one at a time on the main
    // process thread - the win is in everything around it.
    const DETECTION_CONCURRENCY = 20;

    // The grid only ever displays one image per media (the thumbnail - the
    // end10s frame for a video/GIF, the image itself otherwise), so that's
    // the only item whose boxes are spatially valid to overlay on it. ''
    // marks an image's own item; 'end10s' is picked over the other 3 video/
    // GIF frames for the same reason. Falls back to whatever's linked if
    // extraction didn't produce either (partial failure).
    const isDisplayFrame = (framePosition: string | null): boolean => !framePosition || framePosition === "end10s";



    // detected: items of this media already done for this model/class list -
    // their stored boxes are replayed instead of re-running the model, so the
    // event always describes the WHOLE media (all its frames).
    const processOne = async (medias: DetectMediaRef[], detected: ReadonlySet<string>): Promise<void> => {

        const media = medias[0];
        // The item being detected right now - the only one an error below
        // can concern (medias[0] is just the media's first row).
        let current: DetectMediaRef | null = null;
        try {
            const items = medias || [];
            if (items.length === 0) {
                sink.found({ id: media.id, boxes: [], classes: [], classScores: {} });
            } else {
                const perItem: { item: DetectMediaRef; boxes: DetectionBox[] }[] = [];
                for (const item of items) {
                    if (!item.itemId){
                        if (item.kind === "video" || item.kind === "gif") {
                            continue; // skip videos/gifs without extracted frames
                        }
                        item.itemId = item.id; // use the media's own item for images
                    }
                    if (detected.has(item.itemId)) {
                        perItem.push({ item, boxes: MediaStore.getItemDetections(item.itemId).map(({ modelPath, ...box }) => box) });
                        continue;
                    }
                    // Moved/deleted since findAllItemsExists listed it.
                    if (!fs.existsSync(item.media)) {
                        console.log("detectObjects: skipping", item.media, "- file no longer exists");
                        continue;
                    }
                    current = item;
                    const boxes: DetectionBox[] = await inFlight.track(item.media, () => onnxDetector.detect(item.media));
                    // One transaction: boxes and the "done with this model"
                    // record can never disagree (a kill between the two would
                    // let a later run replay one model's boxes as another's).
                    const itemId = item.itemId;
                    inTransaction(() => {
                        MediaStore.replaceItemDetections(itemId, boxes, modelPathId);
                        MediaStore.setItemDetectionState(itemId, boxes.map(box => box.className).join(","), { modelPathId, classList });
                    });
                    perItem.push({ item, boxes });
                }

                const displayItem = perItem.find((d) => isDisplayFrame(d.item.framePosition)) || perItem[0];
                if (!displayItem) {
                    sink.found({ id: media.id, boxes: [], classes: [], classScores: {} });
                    return;
                }
                const classes = [...new Set(perItem.flatMap((d) => d.boxes.map((b) => b.className)))];
                const classScores: Record<string, { min: number; max: number }> = {};
                for (const box of perItem.flatMap((d) => d.boxes)) {
                    const range = classScores[box.className];
                    if (!range) classScores[box.className] = { min: box.score, max: box.score };
                    else {
                        range.min = Math.min(range.min, box.score);
                        range.max = Math.max(range.max, box.score);
                    }
                }
                sink.found({ id: media.id, boxes: displayItem.boxes, classes, classScores });
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                // Moved/deleted between the existence check above and the read.
                console.log("detectObjects: skipping", media.media, "- file no longer exists");
                sink.found({ id: media.id, boxes: [], classes: [], classScores: {} });
                return;
            }
            // Only the failed item's stale boxes go, and only when it is not
            // recorded as done for this model (its boxes + state are written
            // in one transaction, so a failure leaves neither). Never touch
            // the media's other items - they may be done and get replayed.
            if (current?.itemId && !MediaStore.findDetectedItemIds([current.itemId], modelPathId, classList).has(current.itemId)) {
                MediaStore.replaceItemDetections(current.itemId, [], modelPathId);
            }
            failedMediaIds.add(media.id);
            console.error("detectObjects failed for", media.media, error);
            sink.found({ id: media.id, boxes: [], classes: [], classScores: {}, error: (error as Error).message });
        } finally {
            processed++;
            sink.progress({ processed, total });
            if (onProgress) onProgress(processed, total);
        }
    };

    // One page of media at a time: memory stays bounded by the page, and a
    // stop takes effect within the page in flight.
    let videosWithoutFrames = 0;
    let alreadyDone = 0;
    const failedMediaIds = new Set<string>();
    const failedPaths: string[] = [];
    const isFramed = (ref: DetectMediaRef): boolean => ref.kind === "video" || ref.kind === "gif";
    const detectPage = async (medias: PagedMediaRow[]): Promise<void> => {
        const plan = (): { groups: DetectMediaRef[][]; detected: Set<string> } => {
            const refs = itemRefsForMedia(medias);
            const detected = MediaStore.findDetectedItemIds(refs.map(itemKey), modelPathId, classList);
            const byMedia = new Map<string, DetectMediaRef[]>();
            for (const ref of refs) {
                if (!byMedia.has(ref.id)) byMedia.set(ref.id, []);
                (byMedia.get(ref.id) as DetectMediaRef[]).push(ref);
            }
            // Done or not is decided per MEDIA: one undone item keeps all of
            // the media's rows (the done ones are replayed in processOne).
            const groups = [...byMedia.values()].filter(group => group.some(ref => !detected.has(itemKey(ref))));
            return { groups, detected };
        };

        let { groups, detected } = plan();
        if (groups.length > 0) {
            // Detection is keyed by item (an image's 1 item, or a video/GIF's
            // up to 4 extracted frame items - compareImg/HashStore.js), the
            // same content-addressable unit the duplicate finder uses.
            // indexMediaBackground is idempotent (a no-op for content already
            // indexed), so this transparently backfills items for any media
            // never run through "Rebuild index" instead of requiring that first.
            const pendingIds = new Set(groups.map(([ref]) => ref.id));
            await mediaIndexer.indexMediaBackground(medias.filter(m => pendingIds.has(m.id)).map(m => ({
                item: m.localPath,
                mime: m.mime,
                kind: m.kind,
                contentMd5: m.contentMd5,
                id: m.id,
            })));
            // Indexing just created the frame items of videos that had none:
            // re-read the page so they are detected now, not next run.
            if (groups.some(group => isFramed(group[0]) && group.every(ref => !ref.itemId))) ({ groups, detected } = plan());
        }
        for (const group of groups) if (isFramed(group[0]) && group.every(ref => !ref.itemId)) videosWithoutFrames++;

        const skipped = medias.length - groups.length;
        if (skipped > 0) {
            alreadyDone += skipped;
            processed += skipped;
            sink.progress({ processed, total });
            if (onProgress) onProgress(processed, total);
        }

        let cursor = 0;
        const runWorker = async (): Promise<void> => {
            // Stop is honoured before picking up each new media - one already
            // in flight is allowed to finish so its already-computed boxes
            // still get persisted and shown.
            while (cursor < groups.length && !shouldStop()) {
                await processOne(groups[cursor++], detected);
            }
        };
        const workerCount = Math.min(DETECTION_CONCURRENCY, groups.length);
        await Promise.all(Array.from({ length: workerCount }, runWorker));
        for (const m of medias) {
            if (failedMediaIds.delete(m.id) && failedPaths.length < FAILED_PATHS_CAP) failedPaths.push(m.localPath);
        }
    };

    await forEachPage(
        (after, limit) => {
            const rows = listMediaPage(after, limit);
            return { rows, next: rows.length ? rows[rows.length - 1].rowid : after };
        },
        detectPage,
        { pageSize: DETECT_PAGE_SIZE, shouldStop },
    );
    if (videosWithoutFrames > 0) {
        console.warn(`detectObjects: ${videosWithoutFrames} video/GIF media have no extracted frames (frame extraction failed or no content hash yet) and were skipped`);
    }
    return { alreadyDone, withoutFrames: videosWithoutFrames, failedPaths };
};
