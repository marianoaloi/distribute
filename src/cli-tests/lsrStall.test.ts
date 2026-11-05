/**
 * @jest-environment node
 */
// cli/lsr.ts stall watchdog timeout parsing (LSR_STALL_MINUTES).
import { DEFAULT_STALL_MINUTES, stallTimeoutMs } from "../../cli/lsr"

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
