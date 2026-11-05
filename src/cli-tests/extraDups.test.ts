/**
 * @jest-environment node
 */
// cli/extraDups.ts - the extraDups stage runner (pure parts; runInChild is covered by the Electron integration tests).
import {
    DEFAULT_EXTRA_DUPS_MAX_MB, DEFAULT_EXTRA_DUPS_MINUTES, EXTRA_ALGORITHMS, extraDupsMaxMb, ExtraAlgorithm, extraDupsBudgetMs, formatExtraSummary,
    runExtraDuplicates, StoppedError,
} from "../../cli/extraDups"

let log: jest.SpyInstance
let err: jest.SpyInstance
beforeEach(() => {
    log = jest.spyOn(console, "log").mockImplementation(() => undefined)
    err = jest.spyOn(console, "error").mockImplementation(() => undefined)
})
afterEach(() => { log.mockRestore(); err.mockRestore() })

const groupsFor: Record<ExtraAlgorithm, string[][]> = {
    objects: [["a", "b"], ["c", "d"]],
    frames: [["a", "b"]],
    blurFrames: [],
}

describe("EXTRA_ALGORITHMS", () => {
    it("is objects, frames, blurFrames in that order", () => {
        expect([...EXTRA_ALGORITHMS]).toEqual(["objects", "frames", "blurFrames"])
    })
})

describe("runExtraDuplicates", () => {
    it("runs every algorithm in order and returns their groups", async () => {
        const calls: string[] = []
        let t = 0
        const r = await runExtraDuplicates({
            shouldStop: () => false,
            run: async (a) => { calls.push(a); t += 10; return groupsFor[a] },
            now: () => t,
        })
        expect(calls).toEqual(["objects", "frames", "blurFrames"])
        expect(r.stopped).toBe(false)
        expect(r.results.map(x => [x.algorithm, x.groups, x.elapsedMs, x.error])).toEqual([
            ["objects", groupsFor.objects, 10, undefined],
            ["frames", groupsFor.frames, 10, undefined],
            ["blurFrames", [], 10, undefined],
        ])
    })
    it("one failing algorithm is recorded (console.error) and the others still run", async () => {
        const calls: string[] = []
        const r = await runExtraDuplicates({
            shouldStop: () => false,
            run: async (a) => { calls.push(a); if (a === "objects") throw new Error("timed out after 3s (LSR_EXTRA_DUPS_MINUTES)"); return groupsFor[a] },
        })
        expect(calls).toEqual(["objects", "frames", "blurFrames"])
        expect(r.stopped).toBe(false)
        expect(r.results[0]).toMatchObject({ algorithm: "objects", groups: [], error: "timed out after 3s (LSR_EXTRA_DUPS_MINUTES)" })
        expect(r.results[1].error).toBeUndefined()
        expect(err).toHaveBeenCalledTimes(1)
    })
    it("all failing: three errors recorded, not stopped", async () => {
        const r = await runExtraDuplicates({ shouldStop: () => false, run: async () => { throw new Error("db locked") } })
        expect(r.results.map(x => x.error)).toEqual(["db locked", "db locked", "db locked"])
        expect(r.stopped).toBe(false)
        expect(err).toHaveBeenCalledTimes(3)
    })
    it("StoppedError stops at once: stopped:true, no result for that algorithm, no further runs, no error logged", async () => {
        const calls: string[] = []
        const r = await runExtraDuplicates({
            shouldStop: () => false,
            run: async (a) => { calls.push(a); if (a === "frames") throw new StoppedError("stopped"); return groupsFor[a] },
        })
        expect(calls).toEqual(["objects", "frames"])
        expect(r).toEqual({ stopped: true, results: [expect.objectContaining({ algorithm: "objects" })] })
        expect(err).not.toHaveBeenCalled()
    })
    it("shouldStop before the first algorithm runs nothing", async () => {
        const run = jest.fn()
        const r = await runExtraDuplicates({ shouldStop: () => true, run })
        expect(run).not.toHaveBeenCalled()
        expect(r).toEqual({ results: [], stopped: true })
    })
    it("shouldStop raised after an algorithm stops before the next one", async () => {
        let stop = false
        const calls: string[] = []
        const r = await runExtraDuplicates({ shouldStop: () => stop, run: async (a) => { calls.push(a); stop = true; return [] } })
        expect(calls).toEqual(["objects"])
        expect(r.stopped).toBe(true)
        expect(r.results).toHaveLength(1)
    })
    it("onStep reports (done, 3) after every algorithm, failed ones included", async () => {
        const steps: Array<[number, number]> = []
        await runExtraDuplicates({
            shouldStop: () => false,
            run: async (a) => { if (a === "frames") throw new Error("x"); return [] },
            onStep: (d, t) => steps.push([d, t]),
        })
        expect(steps).toEqual([[1, 3], [2, 3], [3, 3]])
    })
    it("onStep is not called for a stopped algorithm", async () => {
        const onStep = jest.fn()
        await runExtraDuplicates({ shouldStop: () => false, run: async () => { throw new StoppedError("s") }, onStep })
        expect(onStep).not.toHaveBeenCalled()
    })
})

describe("extraDupsBudgetMs", () => {
    it("defaults to 60 minutes", () => {
        expect(DEFAULT_EXTRA_DUPS_MINUTES).toBe(60)
        expect(extraDupsBudgetMs({})).toBe(3_600_000)
    })
    it.each([["0.01", 600], ["1", 60_000], ["120", 7_200_000]])("LSR_EXTRA_DUPS_MINUTES=%p -> %d ms", (v, ms) => {
        expect(extraDupsBudgetMs({ LSR_EXTRA_DUPS_MINUTES: v })).toBeCloseTo(ms as number, 6)
    })
    it.each(["", "x", "0", "-1", "Infinity", "NaN"])("falls back to the default for %p", (v) => {
        expect(extraDupsBudgetMs({ LSR_EXTRA_DUPS_MINUTES: v })).toBe(3_600_000)
    })
})

describe("formatExtraSummary", () => {
    it("lists group counts per algorithm", () => {
        expect(formatExtraSummary([
            { algorithm: "objects", groups: [["a", "b"], ["c", "d"]], elapsedMs: 1 },
            { algorithm: "frames", groups: [["a", "b"]], elapsedMs: 1 },
            { algorithm: "blurFrames", groups: [], elapsedMs: 1 },
        ])).toBe("objects: 2 groups, frames: 1 groups, blurFrames: 0 groups")
    })
    it("shows FAILED with the reason", () => {
        expect(formatExtraSummary([
            { algorithm: "objects", groups: [], elapsedMs: 1, error: "timed out after 3s (LSR_EXTRA_DUPS_MINUTES)" },
            { algorithm: "frames", groups: [["x", "y"]], elapsedMs: 1 },
        ])).toBe("objects: FAILED (timed out after 3s (LSR_EXTRA_DUPS_MINUTES)), frames: 1 groups")
    })
    it("says so when nothing finished", () => {
        expect(formatExtraSummary([])).toBe("no algorithm finished")
    })
})

describe("extraDupsMaxMb", () => {
    it("defaults to 4096 MB", () => {
        expect(DEFAULT_EXTRA_DUPS_MAX_MB).toBe(4096)
        expect(extraDupsMaxMb({})).toBe(4096)
    })
    it.each([["1", 1], ["0.2", 1], ["1.9", 1], ["512", 512], [" 64 ", 64]])("LSR_EXTRA_DUPS_MAX_MB=%p -> %d", (v, mb) => {
        expect(extraDupsMaxMb({ LSR_EXTRA_DUPS_MAX_MB: v })).toBe(mb)
    })
    it.each(["", "x", "0", "-1", "NaN", "Infinity"])("falls back to 4096 for %p", (v) => {
        expect(extraDupsMaxMb({ LSR_EXTRA_DUPS_MAX_MB: v })).toBe(4096)
    })
})
