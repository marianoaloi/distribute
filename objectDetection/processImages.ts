
import * as MediaStore from "../mediaDb/MediaStore";
import { DetectionBox, DetectMediaRef } from "../types/domain";
import * as mediaIndexer from "../compareImg/mediaIndexer";

export const processMediaToDetections = async (mainWindow: any, onnxDetector: any, classNames: string[], detectionStopRequested: boolean): Promise<void> => {


    let processed = 0;
    // An item already has a stored result for the *current* class list when
    // its snapshot matches classesSnapshot below - skip re-running the model
    // on it and just replay what's already in item_detection. Any class
    // list edit changes the snapshot, so a redo is forced for everyone again.

    MediaStore.ensureReady();
    const modelPathId = MediaStore.getOrCreateModelPath(onnxDetector.getModelPath() as string);
    const medias = MediaStore.findAllItemsExists() || [];
    const total = medias.length;

    const itemsState = MediaStore.findAllDetectionExists() || [];


    const mediaState = medias.filter(media => !itemsState.get(media.id)).reduce((map, row) => {
        const state = map.get(row.id);
        if (!state) {
            map.set(row.id, [row]);
        } else {
            state.push(row);
        }
        return map;
    }, new Map<string, DetectMediaRef[]>());

    // // Detection is keyed by item (an image's 1 item, or a video/GIF's up to 4
    // // extracted frame items - compareImg/HashStore.js), the same content-
    // // addressable unit the duplicate finder already uses, so two media
    // // sharing identical content only ever get detected once. indexMediaBackground
    // // is idempotent (a no-op for content already indexed), so this
    // // transparently backfills items for any media never run through
    // // "Rebuild index" instead of requiring that as a separate step first.
    // await mediaIndexer.indexMediaBackground([...mediaState.values()].map((mapper) => {
    //     const row = mapper[0];
    //     return {
    //         item: row.media,
    //         mime: row.mime,
    //         kind: row.kind,
    //         contentMd5: row.contentMd5,
    //         id: row.id,
    //     }
    // }));

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



    const processOne = async (medias: DetectMediaRef[]): Promise<void> => {

        const media = medias[0];
        try {
            const items = medias || [];
            if (items.length === 0) {
                mainWindow!.webContents.send("detectionFound", { id: media.id, boxes: [], classes: [] });
            } else {
                const perItem: { item: DetectMediaRef; boxes: DetectionBox[] }[] = [];
                for (const item of items) {
                    if (!item.itemId){
                        if (item.kind === "video" || item.kind === "gif") {
                            continue; // skip videos/gifs without extracted frames
                        }
                        item.itemId = item.id; // use the media's own item for images
                    }
                    const boxes: DetectionBox[] = await onnxDetector.detect(item.media);
                    MediaStore.replaceItemDetections(item.itemId, boxes, modelPathId);
                    MediaStore.setItemDetectionState(item.itemId, boxes.map(box => box.className).join(","));
                    perItem.push({ item, boxes });
                }

                const displayItem = perItem.find((d) => isDisplayFrame(d.item.framePosition)) || perItem[0];
                const classes = [...new Set(perItem.flatMap((d) => d.boxes.map((b) => b.className)))];
                mainWindow!.webContents.send("detectionFound", { id: media.id, boxes: displayItem.boxes, classes });
            }
        } catch (error) {
            MediaStore.replaceItemDetections(media.itemId, [], modelPathId);
            console.error("detectObjects failed for", media.media, error);
            mainWindow!.webContents.send("detectionFound", { id: media.id, boxes: [], classes: [], error: (error as Error).message });
        } finally {
            processed++;
            mainWindow!.webContents.send("detectionProgress", { processed, total });
        }
    };

    const mediaGroups = [...mediaState.values()];
    let cursor = 0;
    const runWorker = async (): Promise<void> => {
        // Stop is honoured before picking up each new media - one already
        // in flight is allowed to finish so its already-computed boxes
        // still get persisted and shown.
        while (cursor < mediaGroups.length && !detectionStopRequested) {
            await processOne(mediaGroups[cursor++]);
        }
    };
    const workerCount = Math.min(DETECTION_CONCURRENCY, mediaGroups.length);
    await Promise.all(Array.from({ length: workerCount }, runWorker));

}