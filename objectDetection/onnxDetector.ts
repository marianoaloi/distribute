import fs from "fs";
import { Jimp } from "jimp";
import * as ort from "onnxruntime-node";

import type { DetectionBox } from "../types/domain";

// Set by the renderer's "choose model" file dialog (see app.js's
// chooseOnnxModel handler) - no longer a fixed path under ./xcxv.
let modelPath: string | null = null;

const SIZE = 640;
const CONF = 0.25;
const IOU = 0.45;

// jpeg-js (the decoder @jimp/js-jpeg calls into) defaults to
// maxMemoryUsageInMB: 512 / maxResolutionInMP: 100 as a decompression-bomb
// guard - a legitimate high-res modern phone photo can exceed that (seen:
// "maxMemoryUsageInMB limit exceeded by at least 31MB" on an ordinary JPEG),
// failing that one item's detection. Raised generously rather than disabled -
// still bounds worst-case memory for a truly malicious/corrupt file.
const JPEG_DECODE_OPTIONS = { maxMemoryUsageInMB: 4096, maxResolutionInMP: 200 };

// Set by app.js's saveDetectionClasses/loadDetectionClasses handlers, backed
// by the detection_class table (mediaDb/MediaStore.js) - falls back to
// "class N" for any index left blank. The chosen model itself is the source
// of truth for how many classes there are (see numClasses in decode()), so
// this list can grow later without touching the detection code.
let classNames: string[] = [];

export const setClassNames = (names: string[]): void => { classNames = Array.isArray(names) ? names : []; };

export const getClassNames = (): string[] => classNames;

const classNameFor = (classId: number): string => classNames[classId] || `class ${classId}`;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

// Resets the cached session so the next detect() call loads the newly
// picked model instead of reusing one built from the old path.
export const setModelPath = (newPath: string): void => {
    if (newPath === modelPath) return;
    modelPath = newPath;
    sessionPromise = null;
};

export const getModelPath = (): string | null => modelPath;

const getSession = (): Promise<ort.InferenceSession> => {
    if (!sessionPromise) sessionPromise = ort.InferenceSession.create(modelPath as string);
    return sessionPromise;
};

export const isAvailable = (): boolean => Boolean(modelPath && fs.existsSync(modelPath));

interface LetterboxContext {
    chw: Float32Array;
    scale: number;
    padX: number;
    padY: number;
    origWidth: number;
    origHeight: number;
}

// Resizes onto a centered SIZE x SIZE canvas preserving aspect ratio (the
// same letterbox preprocessing Ultralytics' export expects), returning the
// float32 CHW tensor data alongside the scale/pad needed to map boxes back
// to the original image's pixel space.
const letterbox = async (input: string): Promise<LetterboxContext> => {
    // Jimp.read(path) drops decode options for local files (only its
    // Buffer/URL branches forward them - see @jimp/core's fromBuffer), so
    // the raised JPEG_DECODE_OPTIONS above would silently never apply if
    // called that way. Reading the buffer ourselves and calling
    // Jimp.fromBuffer directly is what actually gets them through to
    // jpeg-js. Ignored (harmless) for non-JPEG input - Jimp.fromBuffer only
    // applies options keyed by the format it detects.
    const buffer = await fs.promises.readFile(input);
    const image = await Jimp.fromBuffer(buffer, { "image/jpeg": JPEG_DECODE_OPTIONS });
    const origWidth = image.bitmap.width;
    const origHeight = image.bitmap.height;
    const scale = Math.min(SIZE / origWidth, SIZE / origHeight);
    const padX = (SIZE - Math.round(origWidth * scale)) / 2;
    const padY = (SIZE - Math.round(origHeight * scale)) / 2;

    image.background = 0x727272ff;
    image.contain({ w: SIZE, h: SIZE });

    const { data } = image.bitmap; // RGBA, SIZE*SIZE*4
    const plane = SIZE * SIZE;
    const chw = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
        chw[i] = data[i * 4] / 255;
        chw[plane + i] = data[i * 4 + 1] / 255;
        chw[plane * 2 + i] = data[i * 4 + 2] / 255;
    }

    return { chw, scale, padX, padY, origWidth, origHeight };
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const iou = (a: DetectionBox, b: DetectionBox): number => {
    const ax2 = a.x + a.w, ay2 = a.y + a.h;
    const bx2 = b.x + b.w, by2 = b.y + b.h;
    const ix1 = Math.max(a.x, b.x), iy1 = Math.max(a.y, b.y);
    const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
    const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
    const inter = iw * ih;
    const union = a.w * a.h + b.w * b.h - inter;
    return union <= 0 ? 0 : inter / union;
};

// Greedy NMS, class-aware: boxes of different classes never suppress
// each other, matching standard YOLO postprocessing.
const nms = (boxes: DetectionBox[]): DetectionBox[] => {
    const kept: DetectionBox[] = [];
    const sorted = [...boxes].sort((a, b) => b.score - a.score);
    for (const box of sorted) {
        const overlaps = kept.some(k => k.classId === box.classId && iou(k, box) > IOU);
        if (!overlaps) kept.push(box);
    }
    return kept;
};

// Output rows are YOLOv5-style: [cx, cy, w, h, objectness, ...classScores]
// in pixel coordinates of the SIZE x SIZE letterboxed input (not normalized).
const decode = (output: ArrayLike<number>, dims: readonly number[], ctx: LetterboxContext): DetectionBox[] => {
    const [, numAnchors, numCols] = dims;
    const numClasses = numCols - 5;
    const boxes: DetectionBox[] = [];

    for (let a = 0; a < numAnchors; a++) {
        const base = a * numCols;
        const objectness = output[base + 4];
        if (objectness < CONF) continue;

        let bestClass = 0, bestScore = 0;
        for (let c = 0; c < numClasses; c++) {
            const score = output[base + 5 + c];
            if (score > bestScore) { bestScore = score; bestClass = c; }
        }
        const confidence = objectness * bestScore;
        if (confidence < CONF) continue;

        const cx = output[base], cy = output[base + 1];
        const w = output[base + 2], h = output[base + 3];

        // Undo the letterbox pad/scale, then normalize to a 0-1 fraction of
        // the original image so the frontend can position an overlay
        // without needing to know the displayed pixel size.
        const x1 = ((cx - w / 2) - ctx.padX) / ctx.scale;
        const y1 = ((cy - h / 2) - ctx.padY) / ctx.scale;
        const x2 = ((cx + w / 2) - ctx.padX) / ctx.scale;
        const y2 = ((cy + h / 2) - ctx.padY) / ctx.scale;

        boxes.push({
            classId: bestClass,
            className: classNameFor(bestClass),
            score: confidence,
            x: clamp01(x1 / ctx.origWidth),
            y: clamp01(y1 / ctx.origHeight),
            w: clamp01((x2 - x1) / ctx.origWidth),
            h: clamp01((y2 - y1) / ctx.origHeight),
        });
    }

    return nms(boxes);
};

export const detect = async (imagePath: string): Promise<DetectionBox[]> => {
    const session = await getSession();
    const ctx = await letterbox(imagePath);
    const tensor = new ort.Tensor("float32", ctx.chw, [1, 3, SIZE, SIZE]);
    const results = await session.run({ [session.inputNames[0]]: tensor });
    const output = results[session.outputNames[0]];
    return decode(output.data as ArrayLike<number>, output.dims, ctx);
};

export { SIZE, CONF, IOU };
