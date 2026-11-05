// .maloi parsing/applying (objectDetection/maloi.ts) - pure, loads under jest.
import fs from "fs"
import os from "os"
import path from "path"
import { applyMaloi, LoadedMaloi, MaloiDetector, MaloiStore, parseMaloiGroups, parseReshape, readMaloi, RESHAPE_MAX, RESHAPE_MIN, splitClassNames } from "../../objectDetection/maloi"

let dir: string
const write = (name: string, content: string): string => {
    const p = path.join(dir, name)
    fs.writeFileSync(p, content)
    return p
}

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "maloi-test-")) })
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })

let warn: jest.SpyInstance
beforeEach(() => { warn = jest.spyOn(console, "warn").mockImplementation(() => undefined) })
afterEach(() => { warn.mockRestore() })

describe("splitClassNames", () => {
    it("trims and drops empties", () => {
        expect(splitClassNames(" a, b ,,c , ")).toEqual(["a", "b", "c"])
        expect(splitClassNames("")).toEqual([])
    })
})

describe("readMaloi", () => {
    it("resolves a relative onnx path against the .maloi's folder", () => {
        fs.mkdirSync(path.join(dir, "sub"), { recursive: true })
        const p = write("sub/rel.maloi", JSON.stringify({ onnx: "models/m.onnx", classes: "a,b" }))
        expect(readMaloi(p).onnxPath).toBe(path.join(dir, "sub", "models", "m.onnx"))
    })
    it("keeps an absolute onnx path", () => {
        const p = write("abs.maloi", JSON.stringify({ onnx: "/opt/x/m.onnx", classes: "a" }))
        expect(readMaloi(p).onnxPath).toBe("/opt/x/m.onnx")
    })
    it("resolves relative to the .maloi even when the cwd differs", () => {
        const p = write("cwd.maloi", JSON.stringify({ onnx: "m.onnx" }))
        const cwd = process.cwd()
        try {
            process.chdir(os.tmpdir())
            expect(readMaloi(path.relative(process.cwd(), p)).onnxPath).toBe(path.join(dir, "m.onnx"))
        } finally { process.chdir(cwd) }
    })
    it("parses reshape only when it is a number", () => {
        expect(readMaloi(write("r1.maloi", JSON.stringify({ onnx: "m.onnx", reshape: 1280 }))).reshape).toBe(1280)
        expect(readMaloi(write("r4.maloi", JSON.stringify({ onnx: "m.onnx", reshape: null }))).reshape).toBeNull()
        expect(readMaloi(write("r2.maloi", JSON.stringify({ onnx: "m.onnx", reshape: "1280" }))).reshape).toBeNull()
        expect(readMaloi(write("r3.maloi", JSON.stringify({ onnx: "m.onnx" }))).reshape).toBeNull()
    })
    it("trims class names; missing or non-string classes give []", () => {
        expect(readMaloi(write("c1.maloi", JSON.stringify({ onnx: "m.onnx", classes: " cat , dog,, " }))).classNames).toEqual(["cat", "dog"])
        expect(readMaloi(write("c2.maloi", JSON.stringify({ onnx: "m.onnx" }))).classNames).toEqual([])
        expect(readMaloi(write("c3.maloi", JSON.stringify({ onnx: "m.onnx", classes: ["a"] }))).classNames).toEqual([])
    })
    it("parses groups against the class count", () => {
        const p = write("g.maloi", JSON.stringify({ onnx: "m.onnx", classes: "a,b,c", group: [{ name: "g1", expr: "0 && !2" }, { name: "bad", expr: "7" }] }))
        const r = readMaloi(p)
        expect(r.groups.map(g => g.name)).toEqual(["g1"])
        expect(r.groups[0].ast).toEqual({ op: "and", args: [{ op: "class", id: 0 }, { op: "not", arg: { op: "class", id: 2 } }] })
    })
    it("throws a clear error for an unreadable file", () => {
        expect(() => readMaloi(path.join(dir, "nope.maloi"))).toThrow(/Cannot read \.maloi file/)
    })
    it("throws a clear error for bad JSON", () => {
        expect(() => readMaloi(write("bad.maloi", "{ not json"))).toThrow(/Invalid JSON in \.maloi file/)
    })
    it("throws when the JSON is not an object", () => {
        for (const [n, c] of [["n.maloi", "null"], ["a.maloi", "[1,2]"], ["s.maloi", "\"x\""], ["num.maloi", "3"]]) {
            expect(() => readMaloi(write(n, c))).toThrow(/must contain a JSON object/)
        }
    })
    it("throws when onnx is missing, empty or not a string", () => {
        expect(() => readMaloi(write("o1.maloi", JSON.stringify({ classes: "a" })))).toThrow(/has no "onnx" model path/)
        expect(() => readMaloi(write("o2.maloi", JSON.stringify({ onnx: "   " })))).toThrow(/has no "onnx"/)
        expect(() => readMaloi(write("o3.maloi", JSON.stringify({ onnx: 5 })))).toThrow(/has no "onnx"/)
    })
})

describe("parseMaloiGroups", () => {
    const c = (id: number) => ({ op: "class", id })
    it("returns [] for non-array input", () => {
        expect(parseMaloiGroups(undefined, 3)).toEqual([])
        expect(parseMaloiGroups({ name: "x", expr: "0" }, 3)).toEqual([])
        expect(parseMaloiGroups("0", 3)).toEqual([])
    })
    it("parses expr groups, trims names and normalises expr text", () => {
        const g = parseMaloiGroups([{ name: "  people ", expr: "(0||1) && !2" }], 3)
        expect(g).toHaveLength(1)
        expect(g[0].name).toBe("people")
        expect(g[0].ast).toEqual({ op: "and", args: [{ op: "or", args: [c(0), c(1)] }, { op: "not", arg: c(2) }] })
        expect(typeof g[0].expr).toBe("string")
    })
    it("skips groups without a name", () => {
        expect(parseMaloiGroups([{ expr: "0" }, { name: "  ", expr: "0" }, { name: 3, expr: "0" }], 3)).toEqual([])
        expect(warn).toHaveBeenCalled()
    })
    it("keeps the first of duplicate names", () => {
        const g = parseMaloiGroups([{ name: "x", expr: "0" }, { name: "x", expr: "1" }], 3)
        expect(g).toHaveLength(1)
        expect(g[0].ast).toEqual(c(0))
    })
    it("an invalid first entry does not block a later valid one of the same name", () => {
        const g = parseMaloiGroups([{ name: "x", expr: "9" }, { name: "x", expr: "1" }], 3)
        expect(g.map(x => x.ast)).toEqual([c(1)])
    })
    it("skips a group with neither expr nor legacy fields", () => {
        expect(parseMaloiGroups([{ name: "x" }], 3)).toEqual([])
    })
    it("skips an out-of-range expr", () => {
        expect(parseMaloiGroups([{ name: "x", expr: "3" }], 3)).toEqual([])
    })
    it("accepts legacy classes + OR join", () => {
        const g = parseMaloiGroups([{ name: "x", classes: [0, 2], join: "or" }], 3)
        expect(g[0].ast).toEqual({ op: "or", args: [c(0), c(2)] })
    })
    it("accepts legacy classes + AND join with a negative id meaning NOT", () => {
        const g = parseMaloiGroups([{ name: "x", classes: [1, -2], join: " AND " }], 3)
        expect(g[0].ast).toEqual({ op: "and", args: [c(1), { op: "not", arg: c(2) }] })
    })
    it("rejects legacy groups with out-of-range, non-integer or empty ids, or a bad join", () => {
        expect(parseMaloiGroups([{ name: "a", classes: [0, 3], join: "OR" }], 3)).toEqual([])
        expect(parseMaloiGroups([{ name: "b", classes: [-3], join: "OR" }], 3)).toEqual([])
        expect(parseMaloiGroups([{ name: "c", classes: [0.5], join: "OR" }], 3)).toEqual([])
        expect(parseMaloiGroups([{ name: "d", classes: [], join: "OR" }], 3)).toEqual([])
        expect(parseMaloiGroups([{ name: "e", classes: [0], join: "XOR" }], 3)).toEqual([])
        expect(parseMaloiGroups([{ name: "f", classes: [0] }], 3)).toEqual([])
    })
    it("never throws on junk entries", () => {
        expect(() => parseMaloiGroups([null, 1, "x", [], { name: "ok", expr: "0" }], 3)).not.toThrow()
        expect(parseMaloiGroups([null, 1, "x", [], { name: "ok", expr: "0" }], 3).map(g => g.name)).toEqual(["ok"])
    })
})

describe("applyMaloi", () => {
    const setup = () => {
        const calls: string[] = []
        const args: Record<string, unknown> = {}
        const rec = (name: string) => (a?: unknown) => { calls.push(name); args[name] = a; return 1 }
        const detector: MaloiDetector = { setModelPath: rec("setModelPath"), setClassNames: rec("setClassNames"), setModelSize: rec("setModelSize") }
        const store: MaloiStore = { ensureReady: rec("ensureReady"), getOrCreateModelPath: rec("getOrCreateModelPath") as any, saveDetectionClasses: rec("saveDetectionClasses"), saveDetectionGroups: rec("saveDetectionGroups") }
        return { calls, args, detector, store }
    }
    const loaded: LoadedMaloi = { onnxPath: "/m/x.onnx", classNames: ["a", "b"], groups: [], reshape: null }

    it("calls store.ensureReady first and applies everything", () => {
        const { calls, args, detector, store } = setup()
        applyMaloi(loaded, detector, store)
        expect(calls[0]).toBe("ensureReady")
        expect(new Set(calls)).toEqual(new Set(["ensureReady", "setModelPath", "getOrCreateModelPath", "saveDetectionClasses", "saveDetectionGroups", "setClassNames", "setModelSize"]))
        expect(args.setModelPath).toBe("/m/x.onnx")
        expect(args.getOrCreateModelPath).toBe("/m/x.onnx")
        expect(args.saveDetectionClasses).toEqual(["a", "b"])
        expect(args.setClassNames).toEqual(["a", "b"])
        expect(args.saveDetectionGroups).toEqual([])
    })
    it("calls setModelSize(null) when there is no reshape", () => {
        const { calls, args, detector, store } = setup()
        applyMaloi(loaded, detector, store)
        expect(calls).toContain("setModelSize")
        expect(args.setModelSize).toBeNull()
    })
    it("passes reshape through when set", () => {
        const { args, detector, store } = setup()
        applyMaloi({ ...loaded, reshape: 1280 }, detector, store)
        expect(args.setModelSize).toBe(1280)
    })
    it("does not touch the detector if ensureReady throws", () => {
        const { calls, detector, store } = setup()
        store.ensureReady = () => { throw new Error("db down") }
        expect(() => applyMaloi(loaded, detector, store)).toThrow("db down")
        expect(calls).toEqual([])
    })
})

describe("parseReshape", () => {
    it("has bounds 32..4096", () => {
        expect(RESHAPE_MIN).toBe(32)
        expect(RESHAPE_MAX).toBe(4096)
    })
    it("ignores non-numbers (null = detector default)", () => {
        for (const v of [undefined, null, "640", true, {}, [640]]) expect(parseReshape(v, "x.maloi")).toBeNull()
    })
    it("accepts integers within bounds, inclusive", () => {
        expect(parseReshape(32, "x.maloi")).toBe(32)
        expect(parseReshape(640, "x.maloi")).toBe(640)
        expect(parseReshape(4096, "x.maloi")).toBe(4096)
    })
    it.each([31, 4097, 0, -640, 640.5, NaN, Infinity, -Infinity, 1e9])("rejects %p with a message naming reshape and the file", (v) => {
        expect(() => parseReshape(v, "/p/x.maloi")).toThrow(/x\.maloi.*"reshape"/)
    })
})

describe("readMaloi reshape validation", () => {
    it("throws on an out-of-range or fractional reshape", () => {
        expect(() => readMaloi(write("rb1.maloi", JSON.stringify({ onnx: "m.onnx", reshape: 8192 })))).toThrow(/reshape/)
        expect(() => readMaloi(write("rb2.maloi", JSON.stringify({ onnx: "m.onnx", reshape: 16 })))).toThrow(/reshape/)
        expect(() => readMaloi(write("rb3.maloi", JSON.stringify({ onnx: "m.onnx", reshape: 640.5 })))).toThrow(/reshape/)
    })
    it("accepts the bounds", () => {
        expect(readMaloi(write("rb4.maloi", JSON.stringify({ onnx: "m.onnx", reshape: 32 }))).reshape).toBe(32)
        expect(readMaloi(write("rb5.maloi", JSON.stringify({ onnx: "m.onnx", reshape: 4096 }))).reshape).toBe(4096)
    })
    it("a huge reshape in exponent notation is rejected", () => {
        expect(() => readMaloi(write("rb6.maloi", '{"onnx":"m.onnx","reshape":1e6}'))).toThrow(/reshape/)
    })
})
