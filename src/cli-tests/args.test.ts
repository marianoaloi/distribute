// cli/args.ts - argument parsing and boundary validation (pure apart from fs stat).
import fs from "fs"
import os from "os"
import path from "path"
import { parseArgs, parseStages, STAGE_ORDER, USAGE } from "../../cli/args"

let dir: string
let root: string
let maloi: string
beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lsr-args-"))
    root = path.join(dir, "media")
    fs.mkdirSync(root)
    maloi = path.join(dir, "m.maloi")
    fs.writeFileSync(maloi, "{}")
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const ok = (argv: string[]) => {
    const r = parseArgs(argv)
    if (!r.ok || r.help) throw new Error(`expected options, got ${JSON.stringify(r)}`)
    return r.options
}
const err = (argv: string[]): string => {
    const r = parseArgs(argv)
    if (r.ok) throw new Error(`expected an error, got ${JSON.stringify(r)}`)
    return r.error
}

describe("parseStages", () => {
    it("re-sorts into canonical order and dedupes", () => {
        expect(parseStages("duplicates,scan,hash,scan")).toEqual({ ok: true, stages: ["scan", "hash", "duplicates"] })
    })
    it("trims whitespace and ignores empty items", () => {
        expect(parseStages(" index , ,hash ")).toEqual({ ok: true, stages: ["hash", "index"] })
    })
    it("rejects empty lists", () => {
        expect(parseStages("").ok).toBe(false)
        expect(parseStages(" , ").ok).toBe(false)
    })
    it("rejects unknown names and lists them", () => {
        const r = parseStages("scan,foo,Hash")
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.error).toMatch(/unknown stage\(s\): foo, Hash/)
    })
    it("STAGE_ORDER is the documented order", () => {
        expect([...STAGE_ORDER]).toEqual(["scan", "hash", "index", "detect", "duplicates"])
    })
})

describe("parseArgs", () => {
    it("--help / -h win even with other args, and need no root", () => {
        expect(parseArgs(["--help"])).toEqual({ ok: true, help: true })
        expect(parseArgs(["-h", "--root", "/nonexistent"])).toEqual({ ok: true, help: true })
    })
    it("still rejects unknown args before honouring --help", () => {
        expect(parseArgs(["--bogus", "--help"]).ok).toBe(false)
    })
    it("defaults to all stages and requires --maloi for detect", () => {
        expect(err(["--root", root])).toMatch(/--maloi is required/)
        const o = ok(["--root", root, "--maloi", maloi])
        expect(o.stages).toEqual([...STAGE_ORDER])
        expect(o.maloi).toBe(maloi)
        expect(o.verbose).toBe(false)
    })
    it("does not need --maloi when detect is excluded", () => {
        const o = ok(["--root", root, "--stages", "scan,hash,index,duplicates"])
        expect(o.maloi).toBeUndefined()
        expect(o.stages).toEqual(["scan", "hash", "index", "duplicates"])
    })
    it("accepts --flag=value and resolves relative paths", () => {
        const cwd = process.cwd()
        try {
            process.chdir(dir)
            const o = ok(["--root=media", "--stages=hash", "--verbose"])
            expect(o.root).toBe(root)
            expect(o.verbose).toBe(true)
            expect(ok(["--root", "media", "--maloi=m.maloi"]).maloi).toBe(maloi)
        } finally { process.chdir(cwd) }
    })
    it("requires --root", () => {
        expect(err([])).toMatch(/--root is required/)
        expect(err(["--root="])).toMatch(/--root is required/)
    })
    it("rejects a missing value", () => {
        expect(err(["--root"])).toMatch(/--root needs a value/)
        expect(err(["--root", "--verbose"])).toMatch(/--root needs a value/)
        expect(err(["--root", root, "--stages"])).toMatch(/--stages needs a value/)
    })
    it("rejects a repeated flag", () => {
        expect(err(["--root", root, "--root", root])).toMatch(/more than once/)
        expect(err(["--root", root, "--stages=hash", "--stages", "scan"])).toMatch(/more than once/)
    })
    it("rejects unknown arguments, positional args and =value on boolean flags", () => {
        expect(err(["--root", root, "--frobnicate"])).toMatch(/unknown argument: --frobnicate/)
        expect(err(["--root", root, "extra"])).toMatch(/unknown argument: extra/)
        expect(err(["--root", root, "--verbose=1"])).toMatch(/unknown argument/)
    })
    it("rejects a non-existent or non-directory root", () => {
        expect(err(["--root", path.join(dir, "nope")])).toMatch(/not an existing folder/)
        expect(err(["--root", maloi])).toMatch(/not an existing folder/)
    })
    it("rejects a root inside an app tmp folder (tmp with hashIndex)", () => {
        const appTmp = path.join(root, "tmp")
        fs.mkdirSync(path.join(appTmp, "hashIndex"), { recursive: true })
        fs.mkdirSync(path.join(appTmp, "frames", "x"), { recursive: true })
        try {
            expect(err(["--root", appTmp, "--stages", "scan"])).toMatch(/inside an app data folder/)
            expect(err(["--root", path.join(appTmp, "frames", "x"), "--stages", "scan"])).toMatch(/inside an app data folder/)
            // The media root itself (which contains tmp/) stays valid.
            expect(ok(["--root", root, "--stages", "scan"]).root).toBe(root)
        } finally { fs.rmSync(appTmp, { recursive: true, force: true }) }
    })
    it("accepts a folder merely named tmp without a hashIndex", () => {
        const plainTmp = path.join(dir, "tmp")
        fs.mkdirSync(plainTmp, { recursive: true })
        expect(ok(["--root", plainTmp, "--stages", "scan"]).root).toBe(plainTmp)
    })
    it("rejects a missing --maloi file or a folder given as --maloi", () => {
        expect(err(["--root", root, "--maloi", path.join(dir, "x.maloi")])).toMatch(/--maloi file not found/)
        expect(err(["--root", root, "--maloi", root])).toMatch(/--maloi file not found/)
    })
    it("propagates --stages errors", () => {
        expect(err(["--root", root, "--stages", "scan,nope"])).toMatch(/unknown stage/)
        expect(err(["--root", root, "--stages="])).toMatch(/--stages is empty/)
    })
    it("USAGE documents every exit code", () => {
        for (const code of ["0", "1", "2", "3", "130"]) expect(USAGE).toMatch(new RegExp(`^\\s+${code}\\s`, "m"))
    })
})
