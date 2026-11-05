// cli/reportArgs.ts - --report / --format validation.
import fs from "fs"
import os from "os"
import path from "path"
import { checkReportTargets, looksLikeLsrReport, parseFormats, reportStem, targetsFor } from "../../cli/reportArgs"
import { CSV_HEADER } from "../../reporting/report"

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "lsr-rargs-")) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("parseFormats", () => {
    it.each([["json", ["json"]], ["csv", ["csv"]], ["csv,json", ["json", "csv"]], [" json , csv ,json", ["json", "csv"]]])("%p", (raw, out) => {
        expect(parseFormats(raw as string)).toEqual({ ok: true, formats: out })
    })
    it("rejects empty and unknown formats", () => {
        expect(parseFormats("").ok).toBe(false)
        expect(parseFormats(" , ").ok).toBe(false)
        const r = parseFormats("json,xml,JSON")
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.error).toMatch(/unknown report format\(s\): xml, JSON/)
    })
})

describe("reportStem / targetsFor", () => {
    it("strips .json/.csv (any case) and resolves to absolute", () => {
        expect(reportStem("/out/r.json")).toBe("/out/r")
        expect(reportStem("/out/r.CSV")).toBe("/out/r")
        expect(reportStem("/out/r")).toBe("/out/r")
        expect(reportStem("/out/r.txt")).toBe("/out/r.txt")
        expect(reportStem("/out/r.v2")).toBe("/out/r.v2")
        expect(path.isAbsolute(reportStem("rel/r.json"))).toBe(true)
        expect(reportStem("rel/r.json")).toBe(path.resolve("rel/r"))
    })
    it("targets per format", () => {
        expect(targetsFor("/o/r", ["json", "csv"])).toEqual({ json: "/o/r.json", csv: "/o/r.csv" })
        expect(targetsFor("/o/r", ["csv"])).toEqual({ csv: "/o/r.csv" })
    })
})

describe("looksLikeLsrReport", () => {
    const w = (n: string, c: string) => { const p = path.join(dir, n); fs.writeFileSync(p, c); return p }
    it("recognises JSON and CSV reports by their first bytes", () => {
        expect(looksLikeLsrReport(w("a.json", '{"generatedAt":"x","groups":[]}'))).toBe(true)
        expect(looksLikeLsrReport(w("a.csv", `${CSV_HEADER.join(",")}\npixel,1`))).toBe(true)
    })
    it("rejects other content, empty files, a header without newline, and missing files", () => {
        expect(looksLikeLsrReport(w("b.json", '{"other":1}'))).toBe(false)
        expect(looksLikeLsrReport(w("c.json", ' {"generatedAt":1}'))).toBe(false)
        expect(looksLikeLsrReport(w("d.csv", "name,size\n"))).toBe(false)
        expect(looksLikeLsrReport(w("e.csv", CSV_HEADER.join(",")))).toBe(false)
        expect(looksLikeLsrReport(w("f.json", ""))).toBe(false)
        expect(looksLikeLsrReport(path.join(dir, "none.json"))).toBe(false)
    })
})

describe("checkReportTargets", () => {
    it("accepts new files in an existing folder", () => {
        expect(checkReportTargets({ json: path.join(dir, "r.json"), csv: path.join(dir, "r.csv") })).toBeNull()
    })
    it("accepts replacing earlier LSR reports", () => {
        fs.writeFileSync(path.join(dir, "r.json"), '{"generatedAt":"x"}')
        fs.writeFileSync(path.join(dir, "r.csv"), `${CSV_HEADER.join(",")}\n`)
        expect(checkReportTargets({ json: path.join(dir, "r.json"), csv: path.join(dir, "r.csv") })).toBeNull()
    })
    it("refuses a missing folder", () => {
        expect(checkReportTargets({ json: path.join(dir, "nope", "r.json") })).toMatch(/--report folder does not exist/)
    })
    it("refuses a foreign file, for either format", () => {
        fs.writeFileSync(path.join(dir, "r.csv"), "my,precious,spreadsheet\n")
        expect(checkReportTargets({ json: path.join(dir, "r.json"), csv: path.join(dir, "r.csv") }))
            .toMatch(/would overwrite .*r\.csv, which is not an LSR report/)
        expect(fs.readFileSync(path.join(dir, "r.csv"), "utf8")).toBe("my,precious,spreadsheet\n")
    })
    it("refuses a directory as target", () => {
        fs.mkdirSync(path.join(dir, "r.json"))
        expect(checkReportTargets({ json: path.join(dir, "r.json") })).toMatch(/is not a file/)
    })
    it("refuses a folder path that is a file", () => {
        fs.writeFileSync(path.join(dir, "file"), "x")
        expect(checkReportTargets({ json: path.join(dir, "file", "r.json") })).toMatch(/folder does not exist/)
    })
})
