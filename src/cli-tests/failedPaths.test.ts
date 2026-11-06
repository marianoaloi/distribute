// system/failedPaths.ts - the shared cap for per-pass failed file lists.
import { FAILED_PATHS_CAP, pushCapped } from "../../system/failedPaths"

describe("pushCapped", () => {
    it("caps at 100 and keeps the first ones in order", () => {
        expect(FAILED_PATHS_CAP).toBe(100)
        const list: string[] = []
        for (let i = 0; i < 150; i++) pushCapped(list, `/f${i}`)
        expect(list).toHaveLength(100)
        expect(list[0]).toBe("/f0")
        expect(list[99]).toBe("/f99")
    })
    it("does not dedupe (each failure is one entry)", () => {
        const list: string[] = []
        pushCapped(list, "/a"); pushCapped(list, "/a")
        expect(list).toEqual(["/a", "/a"])
    })
    it("never shrinks a list already over the cap", () => {
        const list = Array.from({ length: 120 }, (_, i) => `/x${i}`)
        pushCapped(list, "/new")
        expect(list).toHaveLength(120)
        expect(list).not.toContain("/new")
    })
})
