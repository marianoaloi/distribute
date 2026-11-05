// Keyset-paged readers over the per-folder media DB, for passes that must
// scale to millions of rows (the headless LSR, and the GUI's own LSR chain):
// one bounded page in memory at a time, ordered by media.rowid so a pass can
// stop at any page boundary and the next page query is an index seek.
//
// Unlike MediaStore.findAllMediaThatExists/findAllItemsExists these never
// fs.existsSync inside the query - callers already skip files that vanished
// (mediaIndexer, processImages).
import path from "path";
import * as HashStore from "../compareImg/HashStore";
import { getCacheDir } from "../thumbnails/cache";
import type { DetectMediaRef, MediaRow } from "../types/domain";

const MEDIA_COLUMNS = "rowid, id, localPath, contentMd5, size, mtimeMs, hasAudio, thumbPath, mime, kind, futurePosition";

// Same chunking reason as MediaStore's ID_CHUNK (SQLITE_MAX_VARIABLE_NUMBER).
const ID_CHUNK = 400;

export type PagedMediaRow = MediaRow & { rowid: number };

// Runs fn inside one write transaction: N row writes cost one commit (one
// journal sync) instead of N. fn must be synchronous - better-sqlite3
// transactions cannot span an await.
export const inTransaction = <T>(fn: () => T): T => HashStore.getDb().transaction(fn)();

export const countMedia = (): number =>
    (HashStore.getDb().prepare("SELECT COUNT(*) AS n FROM media").get() as { n: number }).n;

export const listMediaPage = (afterRowid: number, limit: number): PagedMediaRow[] =>
    HashStore.getDb()
        .prepare(`SELECT ${MEDIA_COLUMNS} FROM media WHERE rowid > ? ORDER BY rowid LIMIT ?`)
        .all(afterRowid, limit) as PagedMediaRow[];

// The rows of findAllItemsExists for the given media: each media with each of
// its linked items (a media with no item yet comes back once, itemId null).
export const itemRefsForMedia = (medias: readonly PagedMediaRow[]): DetectMediaRef[] => {
    if (medias.length === 0) return [];
    const db = HashStore.getDb();
    const itemsByMedia = new Map<string, Array<{ itemId: string; framePosition: string | null }>>();
    for (let i = 0; i < medias.length; i += ID_CHUNK) {
        const chunk = medias.slice(i, i + ID_CHUNK).map(m => m.id);
        const rows = db.prepare(`
            SELECT mi.mediaId AS mediaId, i.id AS itemId, i.framePosition AS framePosition
            FROM media_item mi JOIN items i ON i.id = mi.itemId
            WHERE mi.mediaId IN (${chunk.map(() => "?").join(",")})
        `).all(...chunk) as Array<{ mediaId: string; itemId: string; framePosition: string | null }>;
        for (const row of rows) {
            if (!itemsByMedia.has(row.mediaId)) itemsByMedia.set(row.mediaId, []);
            (itemsByMedia.get(row.mediaId) as Array<{ itemId: string; framePosition: string | null }>).push(row);
        }
    }
    const refs: DetectMediaRef[] = [];
    for (const m of medias) {
        const items = itemsByMedia.get(m.id) ?? [{ itemId: null as unknown as string, framePosition: null }];
        for (const item of items) {
            refs.push({
                id: m.id,
                itemId: item.itemId,
                media: m.kind === "image" ? m.localPath : path.join(getCacheDir(), `${item.itemId}.jpg`),
                mime: m.mime,
                kind: m.kind,
                contentMd5: m.contentMd5,
                framePosition: item.framePosition,
            } as DetectMediaRef);
        }
    }
    return refs;
};

// itemRefsForMedia for one keyset page of media - paged by MEDIA rowid, so
// a video's frame items are never split across two pages.
export const listItemsPage = (afterRowid: number, limit: number): { refs: DetectMediaRef[]; lastRowid: number; mediaCount: number } => {
    const medias = listMediaPage(afterRowid, limit);
    if (medias.length === 0) return { refs: [], lastRowid: afterRowid, mediaCount: 0 };
    return { refs: itemRefsForMedia(medias), lastRowid: medias[medias.length - 1].rowid, mediaCount: medias.length };
};
