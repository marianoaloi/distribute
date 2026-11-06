/**
 * @jest-environment node
 */
// cli/lsr.ts stall watchdog timeout parsing (LSR_STALL_MINUTES).
import { ALL_FAILED_MIN_ITEMS, DEFAULT_STALL_MINUTES, everyItemFailed, stallTimeoutMs } from "../../cli/lsr"

describe("stallTimeoutMs", () => {
    it("defaults to 30 minutes", () => {
        expect(DEFAULT_STALL_MINUTES).toBe(30)
        expect(stallTimeoutMs({})).toBe(30 * 60_000)
    })
    it.each([["1", 60_000], ["0.02", 1_200], ["90", 90 * 60_000], [" 5 ", 5 * 60_000]])("LSR_STALL_MINUTES=%p -> %d ms", (v, ms) => {
        expect(stallTimeoutMs({ LSR_STALL_MINUTES: v })).toBeCloseTo(ms as number, 6)
    })
    it.each(["", "abc", "0", "-5", "Infinity", "NaN", "1e400"])("falls back to the default for %p", (v) => {
        expect(stallTimeoutMs({ LSR_STALL_MINUTES: v })).toBe(30 * 60_000)
    })
})

describe("everyItemFailed (stage FAILED when nothing got through)", () => {
    it("threshold is 5 items", () => expect(ALL_FAILED_MIN_ITEMS).toBe(5))
    it.each([
        [0, 5, true], [0, 1000, true],
        [0, 4, false], [0, 0, false],      // too few to call it system-wide
        [1, 5, false], [1, 1000, false],   // any success keeps it item-level
        [10, 0, false],
    ])("succeeded=%d failed=%d -> %p", (ok, failed, expected) => {
        expect(everyItemFailed(ok as number, failed as number)).toBe(expected)
    })
})

describe("everyItemFailed with work done by earlier runs", () => {
    it.each([
        [0, 5, 0, true],
        [0, 5, 1, false],    // earlier runs succeeded: not system-wide
        [0, 1000, 10, false],
        [0, 4, 0, false],
        [1, 5, 0, false],
    ])("succeeded=%d failed=%d alreadyDone=%d -> %p", (ok, failed, done, expected) => {
        expect(everyItemFailed(ok as number, failed as number, done as number)).toBe(expected)
    })
    it("alreadyDone defaults to 0", () => {
        expect(everyItemFailed(0, 5)).toBe(true)
    })
})
