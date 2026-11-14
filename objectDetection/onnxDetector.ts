import fs from "fs";
import { Jimp, ResizeStrategy } from "jimp";
import * as ort from "onnxruntime-node";

import type { DetectionBox } from "../types/domain";
import { CONF, IOU, decodeDetections, type LetterboxGeometry } from "./yoloDecode";

// Set by the renderer's "choose model" file dialog (see app.js's
// chooseOnnxModel handler) - no longer a fixed path under ./xcxv.
let modelPath: string | null = null;

const DEFAULT_SIZE = 640;

// Letterbox/tensor input resolution. Two independent overrides, checked in
// this order (see getSize below):
//   1. modelSize  - set from the chosen .maloi file's "reshape" field
//      (app.js's chooseOnnxModelDialog). Some ONNX exports bake a Reshape op
//      with a hardcoded target shape derived from a specific input
//      resolution - feeding it any other SIZE makes onnxruntime's native
//      ReshapeHelper throw ("input_shape_size == requested_shape_size was
//      false") deep inside session.run(), which no amount of JS-side
//      post-processing can catch or patch. Per-model since it's a property
//      of that specific export, not a general preference.
//   2. userSize   - set via the frontend's "detection size" dialog
//      (app.js's saveDetectionSize handler). A general override for models
//      that don't ship a .maloi/reshape hint but still need a non-default size.
//   3. DEFAULT_SIZE (640) if neither is set.
let modelSize: number | null = null;
let userSize: number | null = null;

const normalizeSize = (size: number | null | undefined): number | null =>
    (typeof size === "number" && Number.isFinite(size) && size > 0) ? Math.round(size) : null;

export const setModelSize = (size: number | null | undefined): void => { modelSize = normalizeSize(size); };
export const setUserSize = (size: number | null | undefined): void => { userSize = normalizeSize(size); };
export const getSize = (): number => modelSize ?? userSize ?? DEFAULT_SIZE;

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

// Two model kinds are supported, told apart by the first output's rank:
//   - YOLO detector, rank 3 -> boxes. YOLOv5 and YOLOv8/11/26 (e.g. the
//     YOLO26x best.onnx) output layouts alike; yoloDecode.ts tells them apart.
//   - Hugging Face image classifier (e.g. food.onnx, a Swin fine-tuned on
//     Food-101): [batch, classes] logits -> one label for the whole image.
const isClassifier = (session: ort.InferenceSession): boolean => {
    const meta = session.outputMetadata[0];
    return Boolean(meta && meta.isTensor && meta.shape.length === 2);
};

// Normalization Hugging Face's image processor applies for Swin/most
// ImageNet-pretrained backbones.
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

// Jimp.read(path) drops decode options for local files (only its
// Buffer/URL branches forward them - see @jimp/core's fromBuffer), so
// the raised JPEG_DECODE_OPTIONS above would silently never apply if
// called that way. Reading the buffer ourselves and calling
// Jimp.fromBuffer directly is what actually gets them through to
// jpeg-js. Ignored (harmless) for non-JPEG input - Jimp.fromBuffer only
// applies options keyed by the format it detects.
const readImage = async (input: string) => {
    const buffer = await fs.promises.readFile(input);
    return Jimp.fromBuffer(buffer, { "image/jpeg": JPEG_DECODE_OPTIONS });
};

interface LetterboxContext extends LetterboxGeometry {
    chw: Float32Array;
}

// Resizes onto a centered size x size canvas preserving aspect ratio (the
// same letterbox preprocessing Ultralytics' export expects), returning the
// float32 CHW tensor data alongside the scale/pad needed to map boxes back
// to the original image's pixel space. size comes from getSize() - passed in
// rather than read again here so it's guaranteed to match the tensor dims
// detect() builds from the same call's value.
const letterbox = async (input: string, size: number): Promise<LetterboxContext> => {
    const image = await readImage(input);
    const origWidth = image.bitmap.width;
    const origHeight = image.bitmap.height;
    const scale = Math.min(size / origWidth, size / origHeight);
    const padX = (size - Math.round(origWidth * scale)) / 2;
    const padY = (size - Math.round(origHeight * scale)) / 2;

    image.background = 0x727272ff;
    image.contain({ w: size, h: size });

    const { data } = image.bitmap; // RGBA, size*size*4
    const plane = size * size;
    const chw = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
        chw[i] = data[i * 4] / 255;
        chw[plane + i] = data[i * 4 + 1] / 255;
        chw[plane * 2 + i] = data[i * 4 + 2] / 255;
    }

    return { chw, scale, padX, padY, origWidth, origHeight };
};

// Classifier preprocessing, as Hugging Face's image processor does it: a
// plain bicubic stretch to size x size (no letterbox), then mean/std
// normalization. size must be what the model was exported for (224 for
// food.onnx - its Swin windows break on anything else, see the .maloi
// "reshape" note at the top).
const resizeNormalize = async (input: string, size: number): Promise<Float32Array> => {
    const image = await readImage(input);
    image.resize({ w: size, h: size, mode: ResizeStrategy.BICUBIC });

    const { data } = image.bitmap; // RGBA, size*size*4
    const plane = size * size;
    const chw = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
        for (let c = 0; c < 3; c++) {
            chw[plane * c + i] = (data[i * 4 + c] / 255 - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
        }
    }
    return chw;
};

// Softmax over a classifier's logits. The top class becomes a box covering
// the whole image, so it flows through the same storage, class filter and
// overlay as a detection. Under CONF the model isn't sure enough and nothing
// is reported, same as a YOLO box under the threshold.
const decodeClassification = (logits: ArrayLike<number>): DetectionBox[] => {
    let best = 0;
    for (let c = 1; c < logits.length; c++) {
        if (logits[c] > logits[best]) best = c;
    }
    let sum = 0;
    for (let c = 0; c < logits.length; c++) sum += Math.exp(logits[c] - logits[best]);
    const score = 1 / sum;
    if (score < CONF) return [];
    return [{ classId: best, className: classNameFor(best), score, x: 0, y: 0, w: 1, h: 1 }];
};

export const detect = async (imagePath: string): Promise<DetectionBox[]> => {
    const session = await getSession();
    const size = getSize();
    if (isClassifier(session)) {
        const chw = await resizeNormalize(imagePath, size);
        const results = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", chw, [1, 3, size, size]) });
        return decodeClassification(results[session.outputNames[0]].data as ArrayLike<number>);
    }
    const ctx = await letterbox(imagePath, size);
    const tensor = new ort.Tensor("float32", ctx.chw, [1, 3, size, size]);
    const results = await session.run({ [session.inputNames[0]]: tensor });
    const output = results[session.outputNames[0]];
    return decodeDetections(output.data as ArrayLike<number>, output.dims, size, ctx, classNameFor);
};

export { DEFAULT_SIZE, CONF, IOU };
