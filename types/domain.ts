// Shared shapes used across the Electron main-process modules (compareImg/,
// mediaDb/, objectDetection/, thumbnails/, app.ts, util.ts). Kept in one
// place so the same media/detection shape isn't redeclared slightly
// differently in every file that touches it.

export type MediaKind = "image" | "video" | "gif";

/** Row shape from the `media` table (mediaDb/mediaSchema.ts). */
export interface MediaRow {
    id: string;
    localPath: string;
    contentMd5: string | null;
    size: number;
    mtimeMs: number;
    hasAudio: number; // stored as 0/1 in sqlite
    thumbPath: string | null;
    mime: string | null;
    kind: MediaKind;
}

/** Input to MediaStore.upsertMedia - one media file's metadata. */
export interface UpsertMediaInput {
    id: string;
    localPath: string;
    filename: string;
    mime?: string | null;
    kind: MediaKind;
    size: number;
    mtimeMs: number;
    hasAudio?: boolean;
    thumbPath?: string | null;
}

export interface MediaMissingMd5Row {
    id: string;
    localPath: string;
    kind: MediaKind;
}

/** A single ONNX detection box, normalized 0-1 against the source image. */
export interface DetectionBox {
    classId: number;
    className: string;
    score: number;
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface DetectionRow extends DetectionBox {
    modelPath?: string | null;
}

export interface ItemDetectionState extends DetectionBox {
    itemId: string;
}

/** Item produced by util.ts's transformDataStreaming and sent to the renderer. */
export interface StreamMediaItem {
    item: string;
    mime: string;
    fileName: string;
    filename: string;
    size: number;
    mtimeMs: number;
    hasAudio: boolean;
    kind: MediaKind;
    id: string;
    contentMd5?: string;
    imported?: boolean;
}

/** A single extracted video frame (compareImg/videoFrames.ts). */
export interface VideoFrame {
    position: string;
    path: string;
}

/** Generic async concurrency limiter shape, reused by fileHash/videoFrames. */
export interface Semaphore {
    acquire: () => Promise<void>;
    release: () => void;
}

/** Shape a thumbnails/providers/* module must implement (see ThumbnailService.ts). */
export interface ThumbnailProvider {
    name: string;
    isAvailable: () => boolean;
    generate: (input: string, output: string) => Promise<void>;
    generateSync: (input: string, output: string) => void;
}


export interface DetectMediaRef {
    id: string;
    itemId: string;
    media: string;
    mime: string | null;
    kind: MediaKind;
    contentMd5: string | null;
    framePosition: string | null;
}

export interface DetectObjectsPayload {
    medias?: DetectMediaRef[];
}