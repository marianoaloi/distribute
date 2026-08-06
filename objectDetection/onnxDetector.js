const fs = require("fs");
const { Jimp } = require("jimp");
const ort = require("onnxruntime-node");

// Set by the renderer's "choose model" file dialog (see app.js's
// chooseOnnxModel handler) - no longer a fixed path under ./xcxv.
let modelPath = null;

const SIZE = 640;
const CONF = 0.25;
const IOU = 0.45;

// Fill in as the real class names are decided - falls back to "class N" for
// any index left blank. The chosen model itself is the source of truth for
// how many classes there are (see numClasses in decode()), so this list can
// grow later without touching the detection code.
const CLASS_NAMES = [];

const classNameFor = (classId) => CLASS_NAMES[classId] || `class ${classId}`;

let sessionPromise = null;

// Resets the cached session so the next detect() call loads the newly
// picked model instead of reusing one built from the old path.
const setModelPath = (newPath) => {
    if (newPath === modelPath) return;
    modelPath = newPath;
    sessionPromise = null;
};

const getModelPath = () => modelPath;

const getSession = () => {
    if (!sessionPromise) sessionPromise = ort.InferenceSession.create(modelPath);
    return sessionPromise;
};

const isAvailable = () => Boolean(modelPath && fs.existsSync(modelPath));

// Resizes onto a centered SIZE x SIZE canvas preserving aspect ratio (the
// same letterbox preprocessing Ultralytics' export expects), returning the
// float32 CHW tensor data alongside the scale/pad needed to map boxes back
// to the original image's pixel space.
const letterbox = async (input) => {
    const image = await Jimp.read(input);
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

const clamp01 = (v) => Math.min(1, Math.max(0, v));

const iou = (a, b) => {
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
const nms = (boxes) => {
    const kept = [];
    const sorted = [...boxes].sort((a, b) => b.score - a.score);
    for (const box of sorted) {
        const overlaps = kept.some(k => k.classId === box.classId && iou(k, box) > IOU);
        if (!overlaps) kept.push(box);
    }
    return kept;
};

// Output rows are YOLOv5-style: [cx, cy, w, h, objectness, ...classScores]
// in pixel coordinates of the SIZE x SIZE letterboxed input (not normalized).
const decode = (output, dims, ctx) => {
    const [, numAnchors, numCols] = dims;
    const numClasses = numCols - 5;
    const boxes = [];

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

const detect = async (imagePath) => {
    const session = await getSession();
    const ctx = await letterbox(imagePath);
    const tensor = new ort.Tensor("float32", ctx.chw, [1, 3, SIZE, SIZE]);
    const results = await session.run({ [session.inputNames[0]]: tensor });
    const output = results[session.outputNames[0]];
    return decode(output.data, output.dims, ctx);
};

module.exports = { detect, isAvailable, setModelPath, getModelPath, SIZE, CONF, IOU, CLASS_NAMES };
