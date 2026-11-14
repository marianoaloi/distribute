// Pure post-processing of a YOLO detector's raw output tensor. No
// onnxruntime/jimp imports, so it loads under plain node and Jest (see
// src/cli-tests/yoloDecode.test.ts); onnxDetector.ts runs the model and
// hands the output here.
//
// Three output layouts, told apart by outputLayout():
//   - yolov5:     [1, anchors, 5 + classes], one row per anchor:
//                 cx, cy, w, h, objectness, ...class scores.
//   - anchorFree: [1, 4 + classes, anchors], YOLOv8/11/26 exported with
//                 end2end=False (e.g. the YOLO26x body model): transposed,
//                 one COLUMN per anchor, no objectness, class scores already
//                 sigmoid. Needs NMS, like yolov5.
//   - end2end:    [1, maxDet, 6], one row per detection: x1, y1, x2, y2,
//                 score, classId. YOLO26's default NMS-free export (YOLOv10
//                 too): already suppressed, so NMS is skipped.
// All three give coordinates in pixels of the size x size letterboxed input.
import type { DetectionBox } from "../types/domain";

export const CONF = 0.25;
export const IOU = 0.45;

export type OutputLayout = "yolov5" | "anchorFree" | "end2end";

// How the image was fitted into the square input (onnxDetector's letterbox),
// needed to map boxes back onto the original image.
export interface LetterboxGeometry {
    scale: number;
    padX: number;
    padY: number;
    origWidth: number;
    origHeight: number;
}

// Anchor points of a stride 8/16/32 head at this input size: 8400 at 640.
export const gridCells = (size: number): number =>
    [8, 16, 32].reduce((n, stride) => n + Math.ceil(size / stride) ** 2, 0);

// Matched on the anchor count first: one per grid cell for anchorFree (8400
// columns at 640), three for YOLOv5 (25200 rows). That count is also what
// tells a 1-class YOLOv5 ([1, 25200, 6]) apart from an end2end export
// ([1, 300, 6]), which share the column count. Heads with other strides
// (P2/P6 variants) fall back to anchors outnumbering the rows of a column.
const pickLayout = (rows: number, cols: number, size: number): OutputLayout => {
    const cells = gridCells(size);
    if (cols === cells) return "anchorFree";
    if (rows === 3 * cells) return "yolov5";
    if (cols === 6) return "end2end";
    return rows < cols ? "anchorFree" : "yolov5";
};

export const outputLayout = (dims: readonly number[], size: number): OutputLayout => {
    const shape = `[${dims.join(", ")}]`;
    if (dims.length !== 3 || dims.some(d => !Number.isInteger(d) || d <= 0)) {
        throw new Error(`Unsupported detector output shape ${shape}: expected [1, rows, cols]`);
    }
    const [, rows, cols] = dims;
    const layout = pickLayout(rows, cols, size);
    // anchorFree needs 4 box rows + a class; yolov5 4 box + objectness + a class.
    if ((layout === "anchorFree" && rows < 5) || (layout === "yolov5" && cols < 6)) {
        throw new Error(`Unsupported detector output shape ${shape}: no class scores`);
    }
    return layout;
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

// Undo the letterbox pad/scale, then normalize to a 0-1 fraction of the
// original image so the frontend can position an overlay without needing
// to know the displayed pixel size.
const toBox = (classId: number, className: string, score: number,
    x1: number, y1: number, x2: number, y2: number, lb: LetterboxGeometry): DetectionBox => {
    const ox1 = (x1 - lb.padX) / lb.scale;
    const oy1 = (y1 - lb.padY) / lb.scale;
    const ox2 = (x2 - lb.padX) / lb.scale;
    const oy2 = (y2 - lb.padY) / lb.scale;
    return {
        classId,
        className,
        score,
        x: clamp01(ox1 / lb.origWidth),
        y: clamp01(oy1 / lb.origHeight),
        w: clamp01((ox2 - ox1) / lb.origWidth),
        h: clamp01((oy2 - oy1) / lb.origHeight),
    };
};

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
export const nms = (boxes: DetectionBox[]): DetectionBox[] => {
    const kept: DetectionBox[] = [];
    const sorted = [...boxes].sort((a, b) => b.score - a.score);
    for (const box of sorted) {
        const overlaps = kept.some(k => k.classId === box.classId && iou(k, box) > IOU);
        if (!overlaps) kept.push(box);
    }
    return kept;
};

// Confidence = objectness x best class score.
const decodeYolov5 = (output: ArrayLike<number>, dims: readonly number[], lb: LetterboxGeometry, nameFor: (classId: number) => string): DetectionBox[] => {
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
        const cx = output[base], cy = output[base + 1], w = output[base + 2], h = output[base + 3];
        boxes.push(toBox(bestClass, nameFor(bestClass), confidence, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, lb));
    }
    return boxes;
};

// Value of row r for anchor a sits at r * numAnchors + a. Confidence = best
// class score (one label per anchor, as Ultralytics' default predict does).
const decodeAnchorFree = (output: ArrayLike<number>, dims: readonly number[], lb: LetterboxGeometry, nameFor: (classId: number) => string): DetectionBox[] => {
    const [, numRows, numAnchors] = dims;
    const numClasses = numRows - 4;
    const boxes: DetectionBox[] = [];
    for (let a = 0; a < numAnchors; a++) {
        let bestClass = 0, bestScore = 0;
        for (let c = 0; c < numClasses; c++) {
            const score = output[(4 + c) * numAnchors + a];
            if (score > bestScore) { bestScore = score; bestClass = c; }
        }
        if (bestScore < CONF) continue;
        const cx = output[a], cy = output[numAnchors + a];
        const w = output[2 * numAnchors + a], h = output[3 * numAnchors + a];
        boxes.push(toBox(bestClass, nameFor(bestClass), bestScore, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, lb));
    }
    return boxes;
};

// Rows past the real detections are zero-padded, so the score check drops them.
const decodeEnd2End = (output: ArrayLike<number>, dims: readonly number[], lb: LetterboxGeometry, nameFor: (classId: number) => string): DetectionBox[] => {
    const [, numRows, numCols] = dims;
    const boxes: DetectionBox[] = [];
    for (let r = 0; r < numRows; r++) {
        const base = r * numCols;
        const score = output[base + 4];
        if (!(score >= CONF)) continue;
        const classId = Math.round(output[base + 5]);
        boxes.push(toBox(classId, nameFor(classId), score, output[base], output[base + 1], output[base + 2], output[base + 3], lb));
    }
    return boxes;
};

export const decodeDetections = (output: ArrayLike<number>, dims: readonly number[], size: number,
    lb: LetterboxGeometry, nameFor: (classId: number) => string): DetectionBox[] => {
    switch (outputLayout(dims, size)) {
        case "anchorFree": return nms(decodeAnchorFree(output, dims, lb, nameFor));
        case "end2end": return decodeEnd2End(output, dims, lb, nameFor);
        default: return nms(decodeYolov5(output, dims, lb, nameFor));
    }
};
