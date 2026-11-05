/**
 * @jest-environment node
 */
// reporting/report.ts - decision report building blocks and the streaming writer.
import fs from "fs"
import os from "os"
import path from "path"
import {
    addToTotals, buildReportGroup, DECIDING_ALGORITHMS, csvEscape, CSV_HEADER, csvRowsFor, emptyTotals, formatBytes,
    groupIdFor, MemberInfo, ReportGroup, writeReport,
} from "../../reporting/report"

const mem = (id: string, o: Partial<MemberInfo> = {}): MemberInfo => ({
    id, path: `/m/${id}`, size: 100, kind: "image", mime: "image/png", hasAudio: false, contentMd5: `md5-${id}`, missing: false, ...o,
})

describe("groupIdFor", () => {
    it("is a sha1 hex of the sorted ids: order-independent and stable", () => {
        expect(groupIdFor(["b", "a", "c"])).toBe(groupIdFor(["c", "b", "a"]))
        expect(groupIdFor(["a", "b"])).toMatch(/^[0-9a-f]{40}$/)
        expect(groupIdFor(["a", "b"])).not.toBe(groupIdFor(["a", "c"]))
    })
    it("does not collide on id concatenation ambiguities", () => {
        expect(groupIdFor(["ab", "c"])).not.toBe(groupIdFor(["a", "bc"]))
    })
    it("does not mutate its input", () => {
        const ids = ["b", "a"]
        groupIdFor(ids)
        expect(ids).toEqual(["b", "a"])
    })
})

describe("buildReportGroup", () => {
    it("keeps the sounded video over bigger silent video and images", () => {
        const g = buildReportGroup("pixel", [
            mem("img", { size: 9000 }),
            mem("silent", { kind: "video", mime: "video/mp4", size: 5000 }),
            mem("sound", { kind: "video", mime: "video/mp4", size: 10, hasAudio: true }),
        ])!
        expect(g.survivorId).toBe("sound")
        expect(g.members.map(m => [m.id, m.role])).toEqual([["img", "remove"], ["silent", "remove"], ["sound", "keep"]])
        expect(g.reclaimableBytes).toBe(14000)
    })
    it("keeps the biggest image; ties go to the smallest id", () => {
        expect(buildReportGroup("pixel", [mem("a", { size: 1 }), mem("b", { size: 5 })])!.survivorId).toBe("b")
        expect(buildReportGroup("pixel", [mem("z", { size: 5 }), mem("m", { size: 5 }), mem("q", { size: 5 })])!.survivorId).toBe("m")
    })
    it("missing members are role 'missing', never survive, never count as reclaimable", () => {
        const g = buildReportGroup("pixel", [
            mem("gone", { kind: "video", mime: "video/mp4", hasAudio: true, size: 99999, missing: true }),
            mem("a", { size: 10 }), mem("b", { size: 20 }),
        ])!
        expect(g.survivorId).toBe("b")
        expect(g.members.find(m => m.id === "gone")!.role).toBe("missing")
        expect(g.reclaimableBytes).toBe(10)
    })
    it("groupId covers every member, missing included", () => {
        const g = buildReportGroup("pixel", [mem("a"), mem("b"), mem("c", { missing: true })])!
        expect(g.groupId).toBe(groupIdFor(["a", "b", "c"]))
    })
    it("fewer than two present members -> null", () => {
        expect(buildReportGroup("pixel", [mem("a"), mem("b", { missing: true })])).toBeNull()
        expect(buildReportGroup("pixel", [mem("a")])).toBeNull()
        expect(buildReportGroup("pixel", [])).toBeNull()
        expect(buildReportGroup("pixel", [mem("a", { missing: true }), mem("b", { missing: true })])).toBeNull()
    })
    it("keeps member order and carries the algorithm", () => {
        const g = buildReportGroup("pixel", [mem("c"), mem("a"), mem("b")])!
        expect(g.algorithm).toBe("pixel")
        expect(g.members.map(m => m.id)).toEqual(["c", "a", "b"])
        expect(g.members.filter(m => m.role === "keep")).toHaveLength(1)
    })
})

describe("totals and formatBytes", () => {
    it("accumulate per algorithm; review groups reclaim nothing", () => {
        const t = emptyTotals()
        addToTotals(t, buildReportGroup("pixel", [mem("a", { size: 10 }), mem("b", { size: 30 })])!)
        addToTotals(t, buildReportGroup("pixel", [mem("c", { size: 5 }), mem("d", { size: 5 }), mem("e", { size: 5, missing: true })])!)
        addToTotals(t, buildReportGroup("objects", [mem("a", { size: 10 }), mem("b", { size: 30 })])!)
        expect(t).toEqual({
            groupsByAlgorithm: { pixel: 2, objects: 1 },
            membersByAlgorithm: { pixel: 5, objects: 2 },
            reclaimableBytesByAlgorithm: { pixel: 15, objects: 0 },
            reclaimableBytes: 15,
            removeFiles: 2,
        })
    })
    it("counts a remove file once across groups when given a shared id set", () => {
        const t = emptyTotals()
        const seen = new Set<string>()
        const g = buildReportGroup("pixel", [mem("a", { size: 10 }), mem("b", { size: 30 })])!
        addToTotals(t, g, seen)
        addToTotals(t, g, seen)
        expect(t.removeFiles).toBe(1)
        expect(t.reclaimableBytes).toBe(10)
        expect(t.reclaimableBytesByAlgorithm.pixel).toBe(20) // per-algorithm sums stay per group
    })
    it.each([[0, "0 B"], [1023, "1023 B"], [1024, "1.0 KB"], [129024, "126.0 KB"], [1048576, "1.0 MB"], [5 * 1024 ** 4, "5.0 TB"], [3 * 1024 ** 5, "3072.0 TB"]])("%d -> %s", (b, s) => {
        expect(formatBytes(b as number)).toBe(s)
    })
})

describe("csvEscape / csvRowsFor", () => {
    it.each([
        ["plain", "plain"], ["a,b", '"a,b"'], ['say "hi"', '"say ""hi"""'], ["line\nbreak", '"line\nbreak"'],
        ["cr\rhere", '"cr\rhere"'], ["", ""], [null, ""], [undefined, ""], [0, "0"], ["semi;colon", "semi;colon"],
    ])("%p -> %p", (v, out) => expect(csvEscape(v)).toBe(out))
    it("one row per member, header-aligned", () => {
        const g = buildReportGroup("pixel", [mem("a", { path: '/m/we,ird "x".png', size: 1 }), mem("b", { size: 2, contentMd5: null, hasAudio: true })])!
        const rows = csvRowsFor(g)
        expect(rows).toHaveLength(2)
        expect(CSV_HEADER).toEqual(["algorithm", "groupId", "role", "id", "path", "size", "kind", "hasAudio", "contentMd5"])
        expect(rows[0]).toBe(`pixel,${g.groupId},remove,a,"/m/we,ird ""x"".png",1,image,0,md5-a`)
        expect(rows[1]).toBe(`pixel,${g.groupId},keep,b,/m/b,2,image,1,`)
    })
})

// Minimal RFC 4180 parser for round-trip checks.
const parseCsv = (text: string): string[][] => {
    const rows: string[][] = []
    let row: string[] = [], field = "", q = false
    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (q) {
            if (c === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (c === '"') q = false; else field += c
        } else if (c === '"') q = true
        else if (c === ",") { row.push(field); field = "" }
        else if (c === "\n") { row.push(field); rows.push(row); row = []; field = "" }
        else field += c
    }
    if (field || row.length) { row.push(field); rows.push(row) }
    return rows
}

describe("writeReport", () => {
    let dir: string
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "lsr-report-")) })
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
    const header = { generatedAt: "2026-11-05T00:00:00.000Z", root: "/media", stages: ["duplicates", "report"], algorithms: { pixel: "2 groups" } }
    async function* gen(groups: ReportGroup[]) { for (const g of groups) yield g }

    it("writes parseable JSON and a CSV with one row per member", async () => {
        const groups = [
            buildReportGroup("pixel", [mem("a", { size: 10 }), mem("b", { size: 30 })])!,
            buildReportGroup("objects", [mem("c", { path: '/m/a,b "c"\nd.png' }), mem("d"), mem("e", { missing: true })])!,
        ]
        const json = path.join(dir, "r.json"), csv = path.join(dir, "r.csv")
        const totals = await writeReport(header, gen(groups), { json, csv })
        const parsed = JSON.parse(fs.readFileSync(json, "utf8"))
        expect(parsed.generatedAt).toBe(header.generatedAt)
        expect(parsed.root).toBe("/media")
        expect(parsed.algorithms).toEqual({ pixel: "2 groups" })
        expect(parsed.groups).toEqual(groups)
        expect(parsed.totals).toEqual(totals)
        expect(fs.readFileSync(json, "utf8").startsWith('{"generatedAt"')).toBe(true)
        const rows = parseCsv(fs.readFileSync(csv, "utf8"))
        expect(rows[0]).toEqual(CSV_HEADER)
        expect(rows.length - 1).toBe(5)
        expect(rows.find(r => r[3] === "c")![4]).toBe('/m/a,b "c"\nd.png')
        expect(rows.find(r => r[3] === "e")![2]).toBe("missing")
    })
    it("0 groups -> valid JSON with groups [] and empty totals; CSV is the header only", async () => {
        const json = path.join(dir, "e.json"), csv = path.join(dir, "e.csv")
        const totals = await writeReport(header, gen([]), { json, csv })
        const parsed = JSON.parse(fs.readFileSync(json, "utf8"))
        expect(parsed.groups).toEqual([])
        expect(parsed.totals).toEqual(emptyTotals())
        expect(totals).toEqual(emptyTotals())
        expect(fs.readFileSync(csv, "utf8")).toBe(CSV_HEADER.join(",") + "\n")
    })
    it("json only / csv only write just that file", async () => {
        const g = [buildReportGroup("pixel", [mem("a"), mem("b")])!]
        await writeReport(header, gen(g), { json: path.join(dir, "only.json") })
        await writeReport(header, gen(g), { csv: path.join(dir, "only.csv") })
        expect(fs.readdirSync(dir).sort()).toEqual(["only.csv", "only.json"])
    })
    it("replaces an existing file completely (no leftover tail)", async () => {
        const json = path.join(dir, "r.json")
        fs.writeFileSync(json, "x".repeat(100000))
        await writeReport(header, gen([]), { json })
        expect(() => JSON.parse(fs.readFileSync(json, "utf8"))).not.toThrow()
    })
    it("streams many groups (backpressure) and still parses", async () => {
        const many: ReportGroup[] = []
        for (let i = 0; i < 3000; i++) many.push(buildReportGroup("pixel", [mem(`a${i}`, { path: `/m/${"p".repeat(200)}${i}` }), mem(`b${i}`)])!)
        const json = path.join(dir, "big.json"), csv = path.join(dir, "big.csv")
        const totals = await writeReport(header, gen(many), { json, csv })
        expect(JSON.parse(fs.readFileSync(json, "utf8")).groups).toHaveLength(3000)
        expect(totals.groupsByAlgorithm.pixel).toBe(3000)
        expect(fs.readFileSync(csv, "utf8").trim().split("\n")).toHaveLength(6001)
    })
    it("a header without maloi omits the key", async () => {
        const json = path.join(dir, "h.json")
        await writeReport(header, gen([]), { json })
        expect(Object.keys(JSON.parse(fs.readFileSync(json, "utf8")))).toEqual(["generatedAt", "root", "stages", "algorithms", "groups", "totals"])
    })
    it("carries pixelGroupsSavedAt (string or null) in the header", async () => {
        const json = path.join(dir, "s.json")
        await writeReport({ ...header, pixelGroupsSavedAt: "2026-11-05T01:02:03.000Z" }, gen([]), { json })
        expect(JSON.parse(fs.readFileSync(json, "utf8")).pixelGroupsSavedAt).toBe("2026-11-05T01:02:03.000Z")
        await writeReport({ ...header, pixelGroupsSavedAt: null }, gen([]), { json })
        expect(JSON.parse(fs.readFileSync(json, "utf8")).pixelGroupsSavedAt).toBeNull()
    })
    it("a failing group source rethrows and leaves neither the target nor a .tmp", async () => {
        async function* bad() { yield buildReportGroup("pixel", [mem("a"), mem("b")])!; throw new Error("db gone") }
        const json = path.join(dir, "x.json"), csv = path.join(dir, "x.csv")
        await expect(writeReport(header, bad(), { json, csv })).rejects.toThrow("db gone")
        expect(fs.readdirSync(dir)).toEqual([])
    })
    it("a failed rewrite keeps the earlier report intact", async () => {
        const json = path.join(dir, "keep.json")
        await writeReport(header, gen([buildReportGroup("pixel", [mem("a"), mem("b")])!]), { json })
        const earlier = fs.readFileSync(json, "utf8")
        async function* bad() { throw new Error("boom") }
        await expect(writeReport({ ...header, generatedAt: "later" }, bad(), { json })).rejects.toThrow("boom")
        expect(fs.readFileSync(json, "utf8")).toBe(earlier)
        expect(fs.existsSync(`${json}.tmp`)).toBe(false)
    })
    it("writes via <target>.tmp: a stale .tmp is replaced and nothing is left besides the target", async () => {
        const json = path.join(dir, "t.json")
        fs.writeFileSync(`${json}.tmp`, "stale garbage from a killed run")
        await writeReport(header, gen([]), { json })
        expect(fs.readdirSync(dir)).toEqual(["t.json"])
        expect(JSON.parse(fs.readFileSync(json, "utf8")).groups).toEqual([])
    })
    it("the target only appears once the report is complete", async () => {
        const json = path.join(dir, "late.json")
        let seenDuring: boolean | null = null
        async function* slow() {
            yield buildReportGroup("pixel", [mem("a"), mem("b")])!
            seenDuring = fs.existsSync(json)
        }
        await writeReport(header, slow(), { json })
        expect(seenDuring).toBe(false)
        expect(fs.existsSync(json)).toBe(true)
    })
})

describe("review-only algorithms (reviewer H1)", () => {
    it("only pixel decides", () => {
        expect([...DECIDING_ALGORITHMS]).toEqual(["pixel"])
    })
    it.each(["objects", "frames", "blurFrames"] as const)("%s: every present member is 'review', no survivor, nothing reclaimable", (alg) => {
        const g = buildReportGroup(alg, [
            mem("a", { size: 10 }), mem("v", { kind: "video", mime: "video/mp4", hasAudio: true, size: 5 }), mem("gone", { missing: true }),
        ])!
        expect(g.survivorId).toBeNull()
        expect(g.reclaimableBytes).toBe(0)
        expect(g.members.map(m => [m.id, m.role])).toEqual([["a", "review"], ["v", "review"], ["gone", "missing"]])
    })
    it.each(["objects", "frames", "blurFrames"] as const)("%s with fewer than 2 present -> null", (alg) => {
        expect(buildReportGroup(alg, [mem("a"), mem("b", { missing: true })])).toBeNull()
    })
    it("A/B/C scenario: pixel {A,B} (B bigger) and objects {A,B,C} (A has audio): no file is both keep and remove", async () => {
        const A = mem("A", { kind: "video", mime: "video/mp4", size: 100, hasAudio: true })
        const B = mem("B", { kind: "video", mime: "video/mp4", size: 200, hasAudio: false })
        const C = mem("C", { kind: "video", mime: "video/mp4", size: 50, hasAudio: false })
        const pixel = buildReportGroup("pixel", [A, B])!
        const objects = buildReportGroup("objects", [A, B, C])!
        // pixel: sounded A wins over bigger silent B (survivor rule), B removed
        expect(pixel.survivorId).toBe("A")
        expect(pixel.members.map(m => [m.id, m.role])).toEqual([["A", "keep"], ["B", "remove"]])
        expect(objects.members.every(m => m.role === "review")).toBe(true)
        expect(objects.survivorId).toBeNull()
        const all = [pixel, objects]
        const keep = new Set(all.flatMap(g => g.members.filter(m => m.role === "keep").map(m => m.id)))
        const remove = new Set(all.flatMap(g => g.members.filter(m => m.role === "remove").map(m => m.id)))
        expect([...keep].filter(id => remove.has(id))).toEqual([])
        for (const g of all) expect(g.members.some(m => !m.missing && m.role !== "remove")).toBe(true)
    })
    it("A/B/C variant with B bigger and no audio anywhere: pixel keeps B, removes A; objects only reviews", () => {
        const A = mem("A", { size: 100 }), B = mem("B", { size: 200 }), C = mem("C", { size: 50 })
        const pixel = buildReportGroup("pixel", [A, B])!
        expect(pixel.members.map(m => [m.id, m.role])).toEqual([["A", "remove"], ["B", "keep"]])
        expect(buildReportGroup("objects", [A, B, C])!.members.map(m => m.role)).toEqual(["review", "review", "review"])
    })
    it("writeReport totals count each remove file once across the whole report", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lsr-report-h1-"))
        try {
            const A = mem("A", { size: 100 }), B = mem("B", { size: 200 }), C = mem("C", { size: 50 })
            async function* gs() {
                yield buildReportGroup("pixel", [A, B])!
                yield buildReportGroup("objects", [A, B, C])!
                yield buildReportGroup("frames", [A, C])!
            }
            const totals = await writeReport({ generatedAt: "t", root: "/r", stages: ["report"] }, gs(), { json: path.join(dir, "h.json") })
            expect(totals.removeFiles).toBe(1)
            expect(totals.reclaimableBytes).toBe(100)
            expect(totals.reclaimableBytesByAlgorithm).toEqual({ pixel: 100, objects: 0, frames: 0 })
            const rep = JSON.parse(fs.readFileSync(path.join(dir, "h.json"), "utf8"))
            expect(rep.totals).toEqual(totals)
        } finally { fs.rmSync(dir, { recursive: true, force: true }) }
    })
    it("csv rows carry the review role", () => {
        const g = buildReportGroup("frames", [mem("a"), mem("b")])!
        expect(csvRowsFor(g).map(r => r.split(",")[2])).toEqual(["review", "review"])
    })
})
