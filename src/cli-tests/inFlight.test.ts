// system/inFlight.ts - ref-counted "files being worked on" registry.
import { begin, end, snapshot, track } from "../../system/inFlight"

afterEach(() => { for (const p of snapshot()) while (snapshot().includes(p)) end(p) })

describe("inFlight", () => {
    it("begin/end add and remove a path", () => {
        begin("/a")
        expect(snapshot()).toEqual(["/a"])
        end("/a")
        expect(snapshot()).toEqual([])
    })
    it("is ref-counted: a path stays until every begin is ended", () => {
        begin("/a"); begin("/a"); begin("/b")
        end("/a")
        expect(snapshot().sort()).toEqual(["/a", "/b"])
        end("/a")
        expect(snapshot()).toEqual(["/b"])
    })
    it("an unmatched end is harmless and does not go negative", () => {
        end("/never")
        begin("/never")
        expect(snapshot()).toEqual(["/never"])
        end("/never")
        expect(snapshot()).toEqual([])
    })
    it("track registers for the duration of fn and returns its value", async () => {
        let seen: string[] = []
        const v = await track("/t", async () => { seen = snapshot(); return 42 })
        expect(v).toBe(42)
        expect(seen).toEqual(["/t"])
        expect(snapshot()).toEqual([])
    })
    it("track unregisters even when fn rejects", async () => {
        await expect(track("/t", async () => { throw new Error("boom") })).rejects.toThrow("boom")
        expect(snapshot()).toEqual([])
    })
    it("overlapping tracks of the same path keep it until both finish", async () => {
        let release1!: () => void
        const p1 = track("/same", () => new Promise<void>(r => { release1 = r }))
        const p2 = track("/same", async () => undefined)
        await p2
        expect(snapshot()).toEqual(["/same"])
        release1(); await p1
        expect(snapshot()).toEqual([])
    })
    it("snapshot is a copy", () => {
        begin("/a")
        const snap = snapshot()
        snap.push("/x")
        expect(snapshot()).toEqual(["/a"])
        end("/a")
    })
})
