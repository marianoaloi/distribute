import path from "path";
import fs from "fs";

import * as mime from "mime-types";
import * as thumbnails from "./thumbnails/ThumbnailService";
import * as cache from "./thumbnails/cache";
import { hasAudio as videoHasAudio } from "./compareImg/videoFrames";
import * as MediaStore from "./mediaDb/MediaStore";
import { backfillContentMd5 } from "./mediaDb/backfill";

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

// A raw item mid-pipeline: mime hasn't been confirmed present/relevant yet
// (mime.lookup can return false), unlike the StreamMediaItem the renderer
// ultimately receives.
interface RawStreamItem extends Omit<StreamMediaItem, "mime"> {
    mime: string | false;
}

const hasUsableMime = (item: RawStreamItem): item is RawStreamItem & { mime: string } =>
    Boolean(item.mime && (item.mime.includes('image') || item.mime.includes('video')));

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
): Promise<void> => {
    const allPaths = folderOpened ? data.map(item => path.join(folderOpened, item)) : data;

    const withMeta = allPaths
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

    // GIFs are many-frame media like video (see compareImg/mediaIndexer.js),
    // not a single still like a plain image, so they're routed through the
    // thumbnail pipeline instead of being emitted as-is.
    const images: StreamMediaItem[] = withMeta.filter(i => i.kind === 'image');
    const framed: StreamMediaItem[] = withMeta.filter(i => i.kind === 'video' || i.kind === 'gif');

    // Batched indexed lookup against the media table so a video/gif whose
    // thumbnail is already cached can skip the slow per-item ffmpeg loop
    // below entirely. Any DB failure here must never stop the folder from
    // opening - fall through to the slow path for every framed item.
    let cached = new Map<string, MediaRow>();
    try {
        MediaStore.ensureReady();
        cached = MediaStore.findAllMediaThatExists()
            .reduce((map, row) => {
                map.set(row.id, row);
                return map;
            }, new Map<string, MediaRow>());
    } catch (error) {
        console.error("transformDataStreaming: media DB lookup failed, falling back to slow path:", (error as Error).message);
        cached = new Map();
    }

    for (const item of images) {
        upsertMediaSafe(item);
    }
    onReadyGo(images);

    const ready: StreamMediaItem[] = [];
    const pending: StreamMediaItem[] = [];
    for (const item of framed) {
        const row = cached.get(item.id);
        const thumbPath = row && row.contentMd5 ? cache.thumbnailPathFor(item.item, row.contentMd5) : null;
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

    // onReadyGo maps to the "directoryOpen" channel which REPLACES the grid
    // (populateArray assigns, it does not append) - it may only be called
    // once per load, so the already-cached items are folded into this single
    // call instead of trickling in through onVideo like the slow ones.

    for (const item of ready) {
        upsertMediaSafe(item);
    }
    onReadyGo(ready);

    const groupSize = 30;
    for (let i = 0; i < pending.length; i += groupSize) {
        const group = pending.slice(i, i + groupSize);
        for (const item of group) {
            const row = cached.get(item.id);
            item.fileName = await thumbnails.getThumbnail(item.item, row && row.contentMd5);
            item.hasAudio = await videoHasAudio(item.item);
            upsertMediaSafe(item);
        }
        onReadyGo(group);
    }

    if (onDone) onDone();

    // Never blocks the load path: content hashing happens off to the side so
    // subsequent loads can read the memoised contentMd5 instead of touching
    // file bytes again.
    backfillContentMd5();
};
