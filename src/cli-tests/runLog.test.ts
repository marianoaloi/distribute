// cli/runLog.ts - per-run log file, routing, rotation and console patching.
import fs from "fs"
import os from "os"
import path from "path"
import { createRunLog, formatArgs, patchConsole, stampFor } from "../../cli/runLog"

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "lsr-log-")) })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const fixed = new Date(2026, 10, 5, 7, 8, 9)
const sinks = () => {
    const out: string[] = []
    const err: string[] = []
    return { out, err, stdout: (t: string) => { out.push(t) }, stderr: (t: string) => { err.push(t) } }
}

describe("stampFor", () => {
    it("formats local time as YYYYMMDD-HHMMSS", () => {
        expect(stampFor(fixed)).toBe("20261105-070809")
    })
})

describe("createRunLog", () => {
    it("creates <root>/tmp/logs/lsr-<stamp>.log", async () => {
        const s = sinks()
        const log = createRunLog(root, { now: () => fixed, ...s })
        expect(log.path).toBe(path.join(root, "tmp", "logs", "lsr-20261105-070809.log"))
        await log.close()
        expect(fs.existsSync(log.path)).toBe(true)
    })
    it("adds -2, -3 suffixes when runs start in the same second", async () => {
        const s = sinks()
        const a = createRunLog(root, { now: () => fixed, ...s }); await a.close()
        const b = createRunLog(root, { now: () => fixed, ...s }); await b.close()
        const c = createRunLog(root, { now: () => fixed, ...s }); await c.close()
        expect(path.basename(b.path)).toBe("lsr-20261105-070809-2.log")
        expect(path.basename(c.path)).toBe("lsr-20261105-070809-3.log")
    })
    it("routes info to stdout, warn/error to stderr, detail to file only; everything to file", async () => {
        const s = sinks()
        const log = createRunLog(root, { ...s })
        log.info("i-line"); log.warn("w-line"); log.error("e-line"); log.detail("d-line")
        await log.close()
        expect(s.out).toEqual(["i-line\n"])
        expect(s.err).toEqual(["WARN w-line\n", "ERROR e-line\n"])
        const text = fs.readFileSync(log.path, "utf8")
        expect(text).toMatch(/^\S+Z INFO  i-line$/m)
        expect(text).toMatch(/ WARN  w-line$/m)
        expect(text).toMatch(/ ERROR e-line$/m)
        expect(text).toMatch(/ DEBUG d-line$/m)
        expect(text.trim().split("\n")).toHaveLength(4)
    })
    it("verbose also echoes detail to stdout", async () => {
        const s = sinks()
        const log = createRunLog(root, { verbose: true, ...s })
        log.detail("d-line")
        await log.close()
        expect(s.out).toEqual(["d-line\n"])
    })
    it("drops writes after close and close is idempotent", async () => {
        const s = sinks()
        const log = createRunLog(root, { ...s })
        log.info("before")
        await log.close()
        log.detail("after")
        await log.close()
        expect(fs.readFileSync(log.path, "utf8")).not.toMatch(/after/)
    })
    it("rotates into <log>.1 past rotateBytes, keeping the latest lines in <log>", async () => {
        const s = sinks()
        const log = createRunLog(root, { rotateBytes: 300, ...s })
        // Spaced writes: the stream has opened (created) the file before the
        // first rotation, as it always has by the time 200 MB were written.
        for (let i = 0; i < 20; i++) { log.detail(`line-${i}-${"x".repeat(30)}`); await new Promise(r => setTimeout(r, 5)) }
        await log.close()
        await new Promise(r => setTimeout(r, 50)) // the rotated stream's end() is not awaited by close()
        expect(fs.existsSync(`${log.path}.1`)).toBe(true)
        const cur = fs.readFileSync(log.path, "utf8")
        expect(cur).toMatch(/line-19-/)
        expect(Buffer.byteLength(cur)).toBeLessThanOrEqual(300)
        const all = fs.readFileSync(`${log.path}.1`, "utf8") + cur
        // only one previous segment is kept, so early lines may be gone, but no line is split
        for (const l of all.trim().split("\n")) expect(l).toMatch(/ DEBUG line-\d+-x{30}$/)
    })
})

describe("createRunLog rotation under a synchronous burst", () => {
    it("rotates even when every write happens in one tick, without stacking streams", async () => {
        const s = sinks()
        const log = createRunLog(root, { rotateBytes: 300, ...s })
        for (let i = 0; i < 20; i++) log.detail(`line-${String(i).padStart(2, "0")}-${"x".repeat(30)}`)
        await log.close()
        await new Promise(r => setTimeout(r, 50))
        const files = fs.readdirSync(path.dirname(log.path)).sort()
        expect(files).toEqual([path.basename(log.path), `${path.basename(log.path)}.1`])
        const cur = fs.readFileSync(log.path, "utf8")
        const prev = fs.readFileSync(`${log.path}.1`, "utf8")
        const lineBytes = Buffer.byteLength(cur.split("\n")[0] + "\n")
        expect(Buffer.byteLength(cur)).toBeLessThanOrEqual(300 + lineBytes)
        expect(Buffer.byteLength(prev)).toBeLessThanOrEqual(300 + lineBytes)
        // the newest line ends up in <log>; every line is whole, in order, none duplicated
        expect(cur).toMatch(/line-19-x{30}\n$/)
        const lines = (prev + cur).trim().split("\n")
        for (const l of lines) expect(l).toMatch(/ DEBUG line-\d{2}-x{30}$/)
        const ids = lines.map(l => Number(/line-(\d{2})/.exec(l)![1]))
        expect(ids).toEqual([...ids].sort((a, b) => a - b))
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids[ids.length - 1]).toBe(19)
    })
    it("counts bytes, not characters (multi-byte text rotates by size on disk)", async () => {
        const s = sinks()
        const log = createRunLog(root, { rotateBytes: 400, ...s })
        for (let i = 0; i < 10; i++) log.detail(`${i}-${"é".repeat(40)}`) // ~80 chars, ~120 bytes per line
        await log.close()
        await new Promise(r => setTimeout(r, 50))
        const cur = fs.readFileSync(log.path)
        const lineBytes = Buffer.byteLength(cur.toString("utf8").split("\n")[0] + "\n")
        expect(cur.length).toBeLessThanOrEqual(400 + lineBytes)
        expect(fs.existsSync(`${log.path}.1`)).toBe(true)
    })
})

describe("writeSync", () => {
    it("appends synchronously to the log (visible before close) and writes stderr", () => {
        const s = sinks()
        const log = createRunLog(root, { ...s })
        log.writeSync("second SIGINT: exiting")
        // no await: the line must already be on disk
        expect(fs.readFileSync(log.path, "utf8")).toMatch(/^\S+Z ERROR second SIGINT: exiting\n$/)
        expect(s.err).toEqual(["second SIGINT: exiting\n"])
        return log.close()
    })
    it("lands after the lines already flushed by the stream", async () => {
        const s = sinks()
        const log = createRunLog(root, { ...s })
        log.info("first")
        await new Promise(r => setTimeout(r, 30))
        log.writeSync("last")
        const lines = fs.readFileSync(log.path, "utf8").trim().split("\n")
        expect(lines[lines.length - 1]).toMatch(/ERROR last$/)
        await log.close()
    })
    it("never throws even if the log folder is gone", async () => {
        const s = sinks()
        const log = createRunLog(root, { ...s })
        await log.close()
        fs.rmSync(path.join(root, "tmp"), { recursive: true, force: true })
        fs.writeFileSync(path.join(root, "tmp"), "now a file") // appendFileSync -> ENOTDIR
        expect(() => log.writeSync("x")).not.toThrow()
        expect(s.err).toEqual(["x\n"])
    })
})

describe("formatArgs", () => {
    it("joins strings, JSON-encodes objects and uses stacks for errors", () => {
        const e = new Error("boom")
        const text = formatArgs(["a", 1, { b: 2 }, e])
        expect(text.startsWith('a 1 {"b":2} Error: boom')).toBe(true)
    })
    it("falls back to String() for circular objects", () => {
        const o: any = {}; o.self = o
        expect(formatArgs([o])).toBe("[object Object]")
    })
})

describe("patchConsole", () => {
    it("routes console.* into the log, counts warn/error, and restores", async () => {
        const s = sinks()
        const log = createRunLog(root, { ...s })
        const before = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug }
        const { counters, restore } = patchConsole(log)
        try {
            console.log("L", 1); console.info("I"); console.debug("D")
            console.warn("W"); console.error("E1"); console.error("E2")
            expect(counters).toEqual({ errors: 2, warnings: 1 })
        } finally { restore() }
        expect(console.log).toBe(before.log)
        expect(console.warn).toBe(before.warn)
        expect(console.error).toBe(before.error)
        expect(console.info).toBe(before.info)
        expect(console.debug).toBe(before.debug)
        await log.close()
        const text = fs.readFileSync(log.path, "utf8")
        expect(text).toMatch(/DEBUG L 1$/m)
        expect(text).toMatch(/DEBUG I$/m)
        expect(text).toMatch(/DEBUG D$/m)
        expect(text).toMatch(/WARN  W$/m)
        expect(text).toMatch(/ERROR E2$/m)
        expect(s.out).toEqual([])
    })
})
