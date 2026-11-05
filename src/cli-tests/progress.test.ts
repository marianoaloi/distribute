// cli/progress.ts - duration/rate formatting and the throttled reporter.
import { createReporter, formatDuration, formatRate, formatSnapshot } from "../../cli/progress"
import type { PipelineSnapshot } from "../../pipeline/PipelineRun"

const snap = (key: string | null, processed = 0, total = 0, startedAt = 0, eta: [number | null, number | null] = [null, null]): PipelineSnapshot => ({
    running: true, kind: "LSR", startedAt: 0,
    stage: key === null ? null : { key, label: key, index: 1, count: 5, processed, total, startedAt },
    etaStageMs: eta[0], etaOverallMs: eta[1],
})

describe("formatDuration", () => {
    it.each([
        [0, "0s"], [44_400, "44s"], [45_000, "45s"], [59_400, "59s"], [59_600, "1m00s"],
        [192_000, "3m12s"], [3_600_000, "1h00m"], [7_980_000, "2h13m"],
        [86_400_000, "1d00h"], [100_800_000, "1d04h"],
    ])("%d ms -> %s", (ms, text) => expect(formatDuration(ms)).toBe(text))
    it("returns ? for negative, NaN and infinite", () => {
        expect(formatDuration(-1)).toBe("?")
        expect(formatDuration(NaN)).toBe("?")
        expect(formatDuration(Infinity)).toBe("?")
    })
})

describe("formatRate", () => {
    it("rounds at or above 10/s and keeps one decimal below", () => {
        expect(formatRate(85.4)).toBe("85/s")
        expect(formatRate(10)).toBe("10/s")
        expect(formatRate(9.94)).toBe("9.9/s")
        expect(formatRate(0)).toBe("0.0/s")
    })
})

describe("formatSnapshot", () => {
    it("returns null without a stage", () => {
        expect(formatSnapshot(snap(null), 1000)).toBeNull()
    })
    it("shows percent, counts, rate and ETAs with a known total", () => {
        const line = formatSnapshot(snap("hash", 1500, 12000, 0, [123_000, 4_200_000]), 20_000)
        expect(line).toBe("[2/5 hash 12.5%] 1500/12000  75/s  ETA 2m03s  overall ETA 1h10m")
    })
    it("shows an item count without a total and omits null ETAs", () => {
        expect(formatSnapshot(snap("scan", 4200, 0, 0), 10_000)).toBe("[2/5 scan] 4200 items  420/s")
    })
    it("caps percent at 100 and survives zero elapsed time", () => {
        const line = formatSnapshot(snap("index", 20, 10, 5000), 5000) as string
        expect(line).toMatch(/100\.0%\] 20\/10/)
        expect(line).not.toMatch(/NaN|Infinity/)
    })
})

describe("createReporter", () => {
    const make = (intervalMs = 5000) => {
        let t = 0
        const lines: string[] = []
        const r = createReporter(l => lines.push(l), { intervalMs, now: () => t })
        return { r, lines, at: (ms: number) => { t = ms } }
    }
    it("prints on every stage change", () => {
        const { r, lines, at } = make()
        r.onProgress(snap("scan", 1)); at(1); r.onProgress(snap("hash", 1)); at(2); r.onProgress(snap("index", 1))
        expect(lines).toHaveLength(3)
    })
    it("throttles within a stage to one line per interval", () => {
        const { r, lines, at } = make(5000)
        r.onProgress(snap("hash", 1, 100))
        for (let t = 100; t < 5000; t += 100) { at(t); r.onProgress(snap("hash", t / 100, 100)) }
        expect(lines).toHaveLength(1)
        at(5000); r.onProgress(snap("hash", 50, 100))
        expect(lines).toHaveLength(2)
        at(6000); r.onProgress(snap("hash", 60, 100))
        expect(lines).toHaveLength(2)
    })
    it("flush prints the latest unprinted snapshot exactly once", () => {
        const { r, lines, at } = make()
        r.onProgress(snap("hash", 1, 100))
        at(10); r.onProgress(snap("hash", 99, 100))
        r.flush()
        expect(lines).toHaveLength(2)
        expect(lines[1]).toMatch(/99\/100/)
        r.flush()
        expect(lines).toHaveLength(2)
    })
    it("flush with nothing reported prints nothing", () => {
        const { r, lines } = make()
        r.flush()
        expect(lines).toEqual([])
    })
    it("a stage-less snapshot prints no line", () => {
        const { r, lines } = make()
        r.onProgress(snap(null))
        expect(lines).toEqual([])
    })
})
