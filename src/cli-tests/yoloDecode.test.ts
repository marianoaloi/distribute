/**
 * @jest-environment node
 */
// objectDetection/yoloDecode.ts on hand-built output tensors, one per layout:
// YOLOv5 rows, YOLOv8/11/26 transposed (end2end=False) and NMS-free end2end.
import { decodeDetections, gridCells, outputLayout } from "../../objectDetection/yoloDecode"

const nameFor = (id: number) => ["a", "b"][id] ?? `class ${id}`
// Image already 640x640: letterbox is the identity.
const identity = { scale: 1, padX: 0, padY: 0, origWidth: 640, origHeight: 640 }

// A real anchorFree output at 640: [1, 4 + 2 classes, 8400], the given
// per-anchor columns first, every other anchor all zeros.
const ANCHORS = 8400
const anchorFreeDims = [1, 6, ANCHORS]
const transposed = (columns: number[][]): Float32Array => {
    const data = new Float32Array(6 * ANCHORS)
    columns.forEach((col, a) => col.forEach((v, r) => { data[r * ANCHORS + a] = v }))
    return data
}

describe("gridCells / outputLayout", () => {
    it("counts stride 8/16/32 anchors", () => {
        expect(gridCells(640)).toBe(8400)
        expect(gridCells(320)).toBe(2100)
    })
    it("tells the three layouts apart", () => {
        expect(outputLayout([1, 25200, 15], 640)).toBe("yolov5")
        expect(outputLayout([1, 15, 8400], 640)).toBe("anchorFree")
        expect(outputLayout([1, 300, 6], 640)).toBe("end2end")
    })
    it("keeps a 1-class YOLOv5 (also 6 columns) as yolov5", () => {
        expect(outputLayout([1, 25200, 6], 640)).toBe("yolov5")
        expect(outputLayout([1, 6300, 6], 320)).toBe("yolov5")
    })
    it("falls back on rows vs columns for other anchor counts", () => {
        expect(outputLayout([1, 15, 10200], 640)).toBe("anchorFree")
        expect(outputLayout([1, 30000, 15], 640)).toBe("yolov5")
    })
    it("rejects shapes it cannot decode", () => {
        expect(() => outputLayout([1, 15], 640)).toThrow(/Unsupported detector output shape/)
        expect(() => outputLayout([1, 4, 8400], 640)).toThrow(/no class scores/)
        expect(() => outputLayout([1, 25200, 5], 640)).toThrow(/no class scores/)
    })
})

describe("decodeDetections, anchorFree (YOLO26 end2end=False)", () => {
    const dims = anchorFreeDims
    it("takes the best class per anchor, drops low scores and suppresses overlaps", () => {
        const data = transposed([
            [320, 320, 64, 64, 0.9, 0.1],  // kept: class a, 0.9
            [322, 322, 64, 64, 0.8, 0.2],  // same class, overlapping: NMS drops it
            [100, 100, 20, 20, 0.05, 0.1], // under CONF
        ])
        const boxes = decodeDetections(data, dims, 640, identity, nameFor)
        expect(boxes).toHaveLength(1)
        expect(boxes[0]).toMatchObject({ classId: 0, className: "a" })
        expect(boxes[0].score).toBeCloseTo(0.9)
        expect(boxes[0].x).toBeCloseTo(0.45)
        expect(boxes[0].y).toBeCloseTo(0.45)
        expect(boxes[0].w).toBeCloseTo(0.1)
        expect(boxes[0].h).toBeCloseTo(0.1)
    })
    it("keeps overlapping boxes of different classes", () => {
        const data = transposed([[320, 320, 64, 64, 0.9, 0.1], [320, 320, 64, 64, 0.1, 0.7]])
        const boxes = decodeDetections(data, dims, 640, identity, nameFor)
        expect(boxes.map(b => b.className).sort()).toEqual(["a", "b"])
    })
    it("maps boxes back through the letterbox to the original image", () => {
        // 1280x960 into 640: scale 0.5, 640x480 content, 80px bars top and bottom.
        const lb = { scale: 0.5, padX: 0, padY: 80, origWidth: 1280, origHeight: 960 }
        const [box] = decodeDetections(transposed([[320, 320, 64, 64, 0.9, 0]]), dims, 640, lb, nameFor)
        expect(box.x).toBeCloseTo(576 / 1280)
        expect(box.y).toBeCloseTo(416 / 960)
        expect(box.w).toBeCloseTo(128 / 1280)
        expect(box.h).toBeCloseTo(128 / 960)
    })
})

describe("decodeDetections, yolov5", () => {
    it("scores objectness x class and drops low objectness", () => {
        const cols = 7 // cx, cy, w, h, obj, 2 classes
        const data = new Float32Array(8 * cols)
        data.set([320, 320, 64, 64, 0.5, 0.2, 0.9], 0)       // kept: 0.5 * 0.9 = 0.45, class b
        data.set([100, 100, 20, 20, 0.2, 0.9, 0.1], cols)    // objectness under CONF
        const boxes = decodeDetections(data, [1, 8, cols], 640, identity, nameFor)
        expect(boxes).toHaveLength(1)
        expect(boxes[0]).toMatchObject({ classId: 1, className: "b" })
        expect(boxes[0].score).toBeCloseTo(0.45)
        expect(boxes[0].x).toBeCloseTo(0.45)
    })
})

describe("decodeDetections, end2end (YOLO26 default export)", () => {
    it("reads x1,y1,x2,y2,score,class rows without NMS and skips the zero padding", () => {
        const data = new Float32Array(300 * 6)
        data.set([288, 288, 352, 352, 0.9, 1], 0)
        data.set([290, 290, 354, 354, 0.8, 1], 6) // overlaps, but the model already suppressed
        data.set([10, 10, 20, 20, 0.1, 0], 12)    // under CONF
        const boxes = decodeDetections(data, [1, 300, 6], 640, identity, nameFor)
        expect(boxes).toHaveLength(2)
        expect(boxes[0]).toMatchObject({ classId: 1, className: "b" })
        expect(boxes[0].x).toBeCloseTo(0.45)
        expect(boxes[0].w).toBeCloseTo(0.1)
    })
    it("names class ids past the configured list as class N", () => {
        const data = new Float32Array(300 * 6)
        data.set([288, 288, 352, 352, 0.9, 10], 0)
        expect(decodeDetections(data, [1, 300, 6], 640, identity, nameFor)[0].className).toBe("class 10")
    })
})
