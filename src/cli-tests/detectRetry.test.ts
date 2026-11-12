/**
 * @jest-environment node
 */
// processMediaToDetections with and without retryWithoutClass. better-sqlite3
// is built for Electron's ABI and cannot load under Jest's Node, so the
// MediaStore / mediaPages / mediaIndexer seams are replaced by an in-memory
// fake store; the loop, paging and in-flight tracking are the real code.
import fs from "fs"
import { processMediaToDetections, DetectionSink, DetectorLike } from "../../objectDetection/processImages"

interface Box { className: string; score: number; x: number; y: number; width: number; height: number }

const mockStore = {
    medias: [] as any[],
    items: new Map<string, Array<{ itemId: string; framePosition: string | null }>>(),
    boxes: new Map<string, Box[]>(),
    done: new Set<string>(),
}

jest.mock("../../mediaDb/MediaStore", () => ({
    ensureReady: () => undefined,
    getOrCreateModelPath: () => 1,
    classListKey: (c: string[]) => c.join(","),
    findDetectedItemIds: (ids: string[]) => new Set(ids.filter(i => mockStore.done.has(i))),
    findItemIdsWithDetections: (ids: string[]) => new Set(ids.filter(i => (mockStore.boxes.get(i) ?? []).length > 0)),
    getItemDetections: (id: string) => (mockStore.boxes.get(id) ?? []).map(b => ({ ...b, modelPath: "m" })),
    replaceItemDetections: (id: string, boxes: Box[]) => { mockStore.boxes.set(id, boxes) },
    setItemDetectionState: (id: string) => { mockStore.done.add(id) },
}))
jest.mock("../../mediaDb/mediaPages", () => ({
    countMedia: () => mockStore.medias.length,
    inTransaction: (fn: () => unknown) => fn(),
    listMediaPage: (after: number, limit: number) => mockStore.medias.filter(m => m.rowid > after).slice(0, limit),
    itemRefsForMedia: (medias: any[]) => medias.flatMap(m => (mockStore.items.get(m.id) ?? []).map(it => ({
        id: m.id, itemId: it.itemId, media: m.localPath, mime: null, kind: m.kind, contentMd5: null, framePosition: it.framePosition,
    }))),
}))
jest.mock("../../compareImg/mediaIndexer", () => ({ indexMediaBackground: async () => undefined }))

const box = (className: string): Box => ({ className, score: 0.9, x: 0, y: 0, width: 1, height: 1 })

const addMedia = (id: string, kind: string, frames: string[] = [""]): void => {
    mockStore.medias.push({ id, rowid: mockStore.medias.length + 1, localPath: `/m/${id}`, kind, mime: null, contentMd5: null })
    mockStore.items.set(id, frames.map(f => ({ itemId: `${id}-${f || "img"}`, framePosition: f || null })))
}

let detector: DetectorLike & { detect: jest.Mock }
let sink: { found: jest.Mock; progress: jest.Mock }
const run = (retry: boolean, stop: () => boolean = () => false) =>
    processMediaToDetections(sink as DetectionSink, detector, ["cat"], stop, undefined, retry ? { retryWithoutClass: true } : undefined)
const detectedPaths = (): string[] => detector.detect.mock.calls.map(c => c[0]).sort()
const lastProgress = () => sink.progress.mock.calls[sink.progress.mock.calls.length - 1][0]

beforeEach(() => {
    mockStore.medias = []; mockStore.items.clear(); mockStore.boxes.clear(); mockStore.done.clear()
    detector = { getModelPath: () => "/model.maloi", detect: jest.fn(async () => [box("cat")]) }
    sink = { found: jest.fn(), progress: jest.fn() }
    jest.spyOn(fs, "existsSync").mockReturnValue(true)
    // empty = detected with 0 boxes; hit = has a stored box; fresh = never detected
    addMedia("empty", "image"); mockStore.done.add("empty-img"); mockStore.boxes.set("empty-img", [])
    addMedia("hit", "image"); mockStore.done.add("hit-img"); mockStore.boxes.set("hit-img", [box("dog")])
    addMedia("fresh", "image")
})
afterEach(() => jest.restoreAllMocks())

describe("processMediaToDetections retryWithoutClass", () => {
    it("normal mode does not re-detect a media already done with 0 boxes", async () => {
        await run(false)
        expect(detectedPaths()).toEqual(["/m/fresh"])
        expect(sink.found.mock.calls.map(c => c[0].id)).not.toContain("empty")
    })

    it("retry mode re-detects the 0-box media and persists/emits the new boxes", async () => {
        await run(true)
        expect(detectedPaths()).toContain("/m/empty")
        expect(mockStore.boxes.get("empty-img")).toEqual([box("cat")])
        const ev = sink.found.mock.calls.map(c => c[0]).find(e => e.id === "empty")
        expect(ev.boxes).toEqual([box("cat")])
        expect(ev.classes).toEqual(["cat"])
    })

    it("retry mode skips a media with a stored box but progress reaches total", async () => {
        const stats = await run(true)
        expect(detectedPaths()).not.toContain("/m/hit")
        expect(mockStore.boxes.get("hit-img")).toEqual([box("dog")])
        expect(lastProgress()).toEqual({ processed: 3, total: 3 })
        expect(stats.alreadyDone).toBe(1)
    })

    it("retry mode detects a never-detected media", async () => {
        await run(true)
        expect(detectedPaths()).toEqual(["/m/empty", "/m/fresh"])
    })

    it("retry mode skips a video when any frame has a box, re-runs all frames otherwise", async () => {
        addMedia("vidHit", "video", ["a", "end10s"]); mockStore.boxes.set("vidHit-end10s", [box("dog")])
        mockStore.done.add("vidHit-a"); mockStore.done.add("vidHit-end10s")
        addMedia("vidEmpty", "video", ["a", "end10s"]); mockStore.done.add("vidEmpty-a"); mockStore.done.add("vidEmpty-end10s")
        await run(true)
        expect(detectedPaths().filter(p => p.includes("vid"))).toEqual(["/m/vidEmpty", "/m/vidEmpty"])
    })

    it("honours shouldStop in retry mode", async () => {
        await run(true, () => true)
        expect(detector.detect).not.toHaveBeenCalled()
    })
})
