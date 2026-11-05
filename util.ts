import path from "path";
import fs from "fs";

import * as mime from "mime-types";
import * as cache from "./thumbnails/cache";
import { getPlaceholderPath } from "./thumbnails/providers/placeholder";
import { hasAudio as videoHasAudio, extractFrames } from "./compareImg/videoFrames";
import * as MediaStore from "./mediaDb/MediaStore";
import { backfillContentMd5 } from "./mediaDb/backfill";
import { inTransaction } from "./mediaDb/mediaPages";

import type { MediaKind, MediaRow, StreamMediaItem } from "./types/domain";

const { hashFor } = cache;

const kindFor = (itemMime: string | false): MediaKind => {
    if (itemMime && itemMime.includes('gif')) return 'gif';
    if (itemMime && itemMime.includes('video')) return 'video';
    return 'image';
};

const upsertMediaSafe = (item: StreamMediaItem): void => {
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
        console.error("upsertMedia failed for", item.item, "-", (error as Error).message);
    }
};

// One commit for a whole slice instead of one per row. upsertMediaSafe
// catches per-row failures, so one bad row never rolls back the others; if
// the transaction itself cannot run, fall back to plain per-row writes.
const upsertAllSafe = (items: StreamMediaItem[]): void => {
    if (items.length === 0) return;
    try {
        inTransaction(() => { for (const item of items) upsertMediaSafe(item); });
    } catch (error) {
        console.error("upsertMedia batch failed, retrying row by row -", (error as Error).message);
        for (const item of items) upsertMediaSafe(item);
    }
};

// A raw item mid-pipeline: mime hasn't been confirmed present/relevant yet
// (mime.lookup can return false), unlike the StreamMediaItem the renderer
// ultimately receives.
interface RawStreamItem extends Omit<StreamMediaItem, "mime"> {
    mime: string | false;
}

const hasUsableMime = (item: RawStreamItem): item is RawStreamItem & { mime: string } =>
    Boolean(item.mime && (item.mime.includes('image') || item.mime.includes('video')));

// One PATH_SLICE_SIZE-sized slice of transformDataStreaming's path list run
// through the full business pipeline: stat/mime detection, image vs video/gif
// split, cache-hit check against the media rows already stored for exactly
// this slice's ids (one indexed IN lookup per slice - never the whole media
// table, which on a big library is millions of rows per folder opened), and
// - for whatever isn't already cached - frame extraction. onReadyGo maps to the
// "loadMedias" channel, which appends (addListinActualArray) rather than
// replacing - safe to call multiple times per slice, and once per slice.
const processPathsSlice = async (
    paths: string[],
    onReadyGo: (items: StreamMediaItem[]) => void,
    extraFields: Partial<StreamMediaItem>,
): Promise<void> => {
    const withMeta = paths
        .map(item => { try { return { item, stat: fs.statSync(item) }; } catch { return { item, stat: null }; } })
        .filter((entry): entry is { item: string; stat: fs.Stats } => entry.stat !== null && entry.stat.isFile())
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
                ...extraFields,
            } as RawStreamItem;
        })
        .filter(hasUsableMime);

    // Any DB failure here must never stop the folder from opening - fall
    // through to the slow path (frame extraction) for every framed item.
    let cached = new Map<string, MediaRow>();
    try {
        cached = MediaStore.findMediaByIds(withMeta.filter(i => i.kind !== 'image').map(i => i.id));
    } catch (error) {
        console.error("transformDataStreaming: media DB lookup failed, falling back to slow path:", (error as Error).message);
    }

    // GIFs are many-frame media like video (see compareImg/mediaIndexer.js),
    // not a single still like a plain image, so they're routed through the
    // thumbnail pipeline instead of being emitted as-is.
    const images: StreamMediaItem[] = withMeta.filter(i => i.kind === 'image');
    const framed: StreamMediaItem[] = withMeta.filter(i => i.kind === 'video' || i.kind === 'gif');

    upsertAllSafe(images);
    onReadyGo(images);

    const ready: StreamMediaItem[] = [];
    const pending: StreamMediaItem[] = [];
    for (const item of framed) {
        const row = cached.get(item.id);
        const thumbPath = row && row.contentMd5 ? cache.thumbnailPathFor(item.item, row.id) : null;
        const isReady = Boolean(row)
            && row!.size === item.size
            && row!.mtimeMs === item.mtimeMs
            && Boolean(row!.contentMd5)
            && Boolean(thumbPath)
            && fs.existsSync(thumbPath as string);
        if (isReady) {
            item.fileName = thumbPath as string;
            item.hasAudio = Boolean(row!.hasAudio);
            item.contentMd5 = row!.contentMd5 as string;
            ready.push(item);
        } else {
            pending.push(item);
        }
    }

    upsertAllSafe(ready);
    onReadyGo(ready);

    const groupSize = 10;
    for (let i = 0; i < pending.length; i += groupSize) {
        const group = pending.slice(i, i + groupSize);
        for (const item of group) {
            const frames = await extractFrames(item.item);
            item.fileName = frames.find((f) => f.position === "end10s")?.path || getPlaceholderPath();
            item.hasAudio = await videoHasAudio(item.item);
            upsertMediaSafe(item);
        }
        onReadyGo(group);
    }
};

// Slice size for processPathsSlice above - a folder can hold thousands of
// files, and doing stat/mime-lookup over all of them in one synchronous pass
// before the renderer sees anything would make a big folder's first paint
// take far longer than it needs to. Slicing lets results stream in
// progressively, PATH_SLICE_SIZE files at a time, same idea as the pending
// ffmpeg groupSize above.
const PATH_SLICE_SIZE = 200;

// onDone fires once every video's thumbnail has been generated and sent —
// videos are added one at a time (each awaits its own thumbnail), so the
// caller has no other way to know the grid is still being populated.
//
// extraFields is stamped onto every produced item — used by the database
// import flow to mark cross-folder "fake" items ({ imported: true }) while
// still reusing this same thumbnail/metadata pipeline. Pass an empty
// folderOpened to treat data as absolute paths (import items live outside
// the opened folder).
export const transformDataStreaming = async (
    data: string[],
    folderOpened: string,
    onReadyGo: (items: StreamMediaItem[]) => void,
    onSendOneMedia: (item: StreamMediaItem) => void,
    onDone?: () => void,
    extraFields: Partial<StreamMediaItem> = {},
    // backfill: false skips the trailing fire-and-forget content-hash pass -
    // for a caller (the headless LSR) that runs that pass itself, once,
    // instead of one overlapping pass per folder.
    options: { backfill?: boolean } = {},
): Promise<void> => {
    const allPaths = folderOpened ? data.map(item => path.join(folderOpened, item)) : data;
    console.log("transformDataStreaming: processing", allPaths.length, "items in", folderOpened || "absolute paths");

    try {
        MediaStore.ensureReady();
        for (let i = 0; i < allPaths.length; i += PATH_SLICE_SIZE) {
            console.log("transformDataStreaming: processing slice", i / PATH_SLICE_SIZE + 1 , "of", Math.ceil(allPaths.length / PATH_SLICE_SIZE));
            await processPathsSlice(allPaths.slice(i, i + PATH_SLICE_SIZE), onReadyGo, extraFields);
        }
    } catch (error) {
        console.error("transformDataStreaming: failed:", (error as Error).message);
    } finally {
        if (onDone) onDone();
    }

    // Never blocks the load path: content hashing happens off to the side so
    // subsequent loads can read the memoised contentMd5 instead of touching
    // file bytes again.
    if (options.backfill !== false) backfillContentMd5();
};
