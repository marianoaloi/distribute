/**
 * @jest-environment node
 */
// End-to-end tests of the headless LSR CLI (cli/lsr.ts) run as a child
// process under Electron's bundled Node (better-sqlite3 is built for its ABI).
//
// Opt-in, because they need the built CLI and the Electron + ffmpeg binaries:
//   npm run build:electron
//   LSR_INTEGRATION=1 CI=true npx react-scripts test --watchAll=false src/cli-tests/lsr.integration
import { spawn, spawnSync, ChildProcess } from "child_process"
import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"

const REPO = path.resolve(__dirname, "..", "..")
const ELECTRON = path.join(REPO, "node_modules", "electron", "dist", "electron")
const FFMPEG = path.join(REPO, "node_modules", "ffmpeg-static", "ffmpeg")
const CLI = path.join(REPO, "electron-dist", "cli", "lsr.js")
const enabled = process.env.LSR_INTEGRATION === "1"
const d = enabled ? describe : describe.skip

jest.setTimeout(180_000)

interface RunResult { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }

const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" }

const lsr = (args: string[], extraEnv: NodeJS.ProcessEnv = {}): RunResult => {
    const r = spawnSync(ELECTRON, [CLI, ...args], { env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 170_000 })
    return { code: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr }
}

const lsrAsync = (args: string[]): { child: ChildProcess; done: Promise<RunResult>; output: () => string } => {
    const child = spawn(ELECTRON, [CLI, ...args], { env })
    let stdout = ""
    let stderr = ""
    child.stdout!.on("data", (b) => { stdout += b })
    child.stderr!.on("data", (b) => { stderr += b })
    const done = new Promise<RunResult>((resolve) => child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr })))
    return { child, done, output: () => stdout + stderr }
}

const waitFor = async (cond: () => boolean, ms = 60_000): Promise<void> => {
    const until = Date.now() + ms
    while (!cond()) {
        if (Date.now() > until) throw new Error("timed out waiting")
        await new Promise(r => setTimeout(r, 20))
    }
}

// Runs a read-only SQL query against <root>/tmp/hashIndex/index.db.
const query = (root: string, sql: string): any[] => {
    const script = `const D=require(${JSON.stringify(path.join(REPO, "node_modules", "better-sqlite3"))});` +
        `const db=new D(${JSON.stringify(path.join(root, "tmp", "hashIndex", "index.db"))},{readonly:true});` +
        `process.stdout.write(JSON.stringify(db.prepare(${JSON.stringify(sql)}).all()))`
    const r = spawnSync(ELECTRON, ["-e", script], { env, encoding: "utf8" })
    if (r.status !== 0) throw new Error(r.stderr)
    return JSON.parse(r.stdout)
}

// Runs write SQL (exec) against <root>/tmp/hashIndex/index.db.
const execSql = (root: string, sql: string): void => {
    const script = `const D=require(${JSON.stringify(path.join(REPO, "node_modules", "better-sqlite3"))});` +
        `const db=new D(${JSON.stringify(path.join(root, "tmp", "hashIndex", "index.db"))});db.exec(${JSON.stringify(sql)});db.close()`
    const r = spawnSync(ELECTRON, ["-e", script], { env, encoding: "utf8" })
    if (r.status !== 0) throw new Error(r.stderr)
}

const ffmpeg = (...args: string[]): void => {
    const r = spawnSync(FFMPEG, ["-loglevel", "error", "-y", ...args], { encoding: "utf8" })
    if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`)
}

// path -> md5 of every file under root, excluding the app's own <root>/tmp.
const snapshotTree = (root: string): Record<string, string> => {
    const out: Record<string, string> = {}
    const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name)
            if (dir === root && e.name === "tmp") continue
            if (e.isDirectory()) walk(p)
            else out[path.relative(root, p)] = crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex")
        }
    }
    walk(root)
    return out
}

// Like snapshotTree, but records symlinks/fifos by type+target instead of reading them.
const snapshotTreeNoSpecial = (root: string): Record<string, string> => {
    const out: Record<string, string> = {}
    const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name)
            if (dir === root && e.name === "tmp") continue
            if (e.isSymbolicLink()) out[path.relative(root, p)] = `link:${fs.readlinkSync(p)}`
            else if (e.isFIFO()) out[path.relative(root, p)] = "fifo"
            else if (e.isDirectory()) walk(p)
            else out[path.relative(root, p)] = crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex")
        }
    }
    walk(root)
    return out
}

// Live extraDups child processes working on <root> (ps, so no pgrep self-match).
const extraChildrenOf = (root: string): string[] =>
    spawnSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" }).stdout.split("\n")
        .filter(l => l.includes("extraDupsChild.js") && l.includes(root))

const logsOf = (root: string): string[] => {
    const dir = path.join(root, "tmp", "logs")
    // Oldest first: by stamp, then by the -N suffix (a bare name is run 1).
    const key = (f: string): [string, number] => { const m = /^lsr-(\d{8}-\d{6})(?:-(\d+))?\.log$/.exec(f)!; return [m[1], Number(m[2] ?? 1)] }
    return fs.existsSync(dir)
        ? fs.readdirSync(dir).filter(f => /^lsr-\d{8}-\d{6}(-\d+)?\.log$/.test(f))
            .sort((a, b) => { const [sa, na] = key(a), [sb, nb] = key(b); return sa < sb ? -1 : sa > sb ? 1 : na - nb })
        : []
}
const lockOf = (root: string): string => path.join(root, "tmp", "lsr.lock")

// Lines "stage <name> done ..." in output order.
const stagesDone = (stdout: string): string[] =>
    [...stdout.matchAll(/^stage (\w+) done/gm)].map(m => m[1])

let base: string
let root: string // small fixture: an exact duplicate pair, other images, a video with audio
let pristine: Record<string, string>

const makeFixture = (dir: string): void => {
    fs.mkdirSync(path.join(dir, "sub", "deep"), { recursive: true })
    fs.mkdirSync(path.join(dir, "sub", "tmp"), { recursive: true })
    ffmpeg("-f", "lavfi", "-i", "color=red:s=32x32", "-frames:v", "1", path.join(dir, "a.png"))
    fs.copyFileSync(path.join(dir, "a.png"), path.join(dir, "sub", "a-copy.png"))
    ffmpeg("-f", "lavfi", "-i", "testsrc=s=48x48", "-frames:v", "1", path.join(dir, "b.png"))
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=40x30", "-frames:v", "1", path.join(dir, "sub", "deep", "c.png"))
    ffmpeg("-f", "lavfi", "-i", "testsrc=s=64x48:d=1", "-f", "lavfi", "-i", "sine=d=1", "-shortest", "-pix_fmt", "yuv420p", path.join(dir, "v.mp4"))
    fs.writeFileSync(path.join(dir, "notes.txt"), "not media\n")
    // A nested tmp/ is skipped by the scan at any depth.
    fs.copyFileSync(path.join(dir, "b.png"), path.join(dir, "sub", "tmp", "ignored.png"))
}

const NON_DETECT = "scan,hash,index,duplicates"

d("lsr CLI (Electron integration)", () => {
    beforeAll(() => {
        for (const p of [ELECTRON, FFMPEG, CLI]) if (!fs.existsSync(p)) throw new Error(`missing ${p} - run npm run build:electron / npm install`)
        base = fs.mkdtempSync(path.join(os.tmpdir(), "lsr-it-"))
        root = path.join(base, "media")
        makeFixture(root)
        pristine = snapshotTree(root)
    })
    afterAll(() => { if (base) fs.rmSync(base, { recursive: true, force: true }) })

    describe("usage and configuration errors (exit 2)", () => {
        it("--help exits 0 and prints usage", () => {
            const r = lsr(["--help"])
            expect(r.code).toBe(0)
            expect(r.stdout).toMatch(/^Usage:/)
            expect(r.stdout).toMatch(/Exit codes:/)
        })
        it.each([
            [["--root", "/definitely/not/here", "--stages", "scan"], /not an existing folder/],
            [["--stages", "scan"], /--root is required/],
            [["--root", "ROOT", "--stages", "scan,bogus"], /unknown stage/],
            [["--root", "ROOT"], /--maloi is required/],
            [["--root", "ROOT", "--nope"], /unknown argument/],
            [["--root", "ROOT", "--maloi", "/no/such.maloi"], /--maloi file not found/],
            [["--root", "/", "--stages", "scan"], /cannot be the filesystem root/],
            [["--root", "/proc", "--stages", "scan"], /cannot be a pseudo-filesystem/],
            [["--root", "/proc/self", "--stages", "scan"], /cannot be a pseudo-filesystem/],
        ])("%j -> exit 2", (args, message) => {
            const r = lsr((args as string[]).map(a => a === "ROOT" ? root : a))
            expect(r.code).toBe(2)
            expect(r.stderr).toMatch(message as RegExp)
            expect(r.stderr).toMatch(/Usage:/)
        })
        it("arg errors create nothing under the root", () => {
            lsr(["--root", root, "--stages", "nope"])
            expect(fs.existsSync(path.join(root, "tmp"))).toBe(false)
        })
        it("plain node (wrong ABI for better-sqlite3) -> exit 2 with the Electron hint", () => {
            const r = spawnSync(process.execPath, [CLI, "--root", root, "--stages", "scan"], { encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } })
            expect(r.status).toBe(2)
            expect(r.stderr).toMatch(/cannot load better-sqlite3/)
            expect(r.stderr).toMatch(/ELECTRON_RUN_AS_NODE=1 electron/)
        })
        it("--maloi with invalid JSON -> exit 2", () => {
            const bad = path.join(base, "bad.maloi")
            fs.writeFileSync(bad, "{ nope")
            const r = lsr(["--root", root, "--maloi", bad])
            expect(r.code).toBe(2)
            expect(r.stderr).toMatch(/Invalid JSON in \.maloi/)
            expect(fs.existsSync(lockOf(root))).toBe(false)
        })
        it("--maloi without an onnx field -> exit 2", () => {
            const noOnnx = path.join(base, "noonnx.maloi")
            fs.writeFileSync(noOnnx, JSON.stringify({ classes: "a,b" }))
            const r = lsr(["--root", root, "--maloi", noOnnx])
            expect(r.code).toBe(2)
            expect(r.stderr).toMatch(/has no "onnx" model path/)
        })
        it("--maloi with an out-of-range reshape -> exit 2", () => {
            const m = path.join(base, "reshape.maloi")
            fs.writeFileSync(m, JSON.stringify({ onnx: "model.onnx", classes: "a", reshape: 100000 }))
            const r = lsr(["--root", root, "--maloi", m])
            expect(r.code).toBe(2)
            expect(r.stderr).toMatch(/invalid "reshape" 100000/)
            expect(fs.existsSync(lockOf(root))).toBe(false)
        })
        it("--maloi pointing at a missing ONNX model, with detect -> exit 2 before any stage", () => {
            const fake = path.join(base, "fake.maloi")
            fs.writeFileSync(fake, JSON.stringify({ onnx: "missing/model.onnx", classes: "cat,dog" }))
            const r = lsr(["--root", root, "--maloi", fake, "--stages", "scan,detect"])
            expect(r.code).toBe(2)
            expect(r.stderr).toMatch(/ONNX model not found: .*missing\/model\.onnx/)
            expect(stagesDone(r.stdout)).toEqual([])
            expect(fs.existsSync(lockOf(root))).toBe(false)
        })
        it("--maloi with a model file but no classes, with detect -> exit 2", () => {
            const model = path.join(base, "model.onnx")
            fs.writeFileSync(model, "not really onnx")
            const m = path.join(base, "noclasses.maloi")
            fs.writeFileSync(m, JSON.stringify({ onnx: "model.onnx" }))
            const r = lsr(["--root", root, "--maloi", m, "--stages", "detect"])
            expect(r.code).toBe(2)
            expect(r.stderr).toMatch(/lists no classes/)
        })
        it("a second run while another live process holds the lock -> exit 2, lock untouched", () => {
            fs.mkdirSync(path.join(root, "tmp"), { recursive: true })
            fs.writeFileSync(lockOf(root), String(process.pid)) // this jest worker: alive
            try {
                const r = lsr(["--root", root, "--stages", "scan"])
                expect(r.code).toBe(2)
                expect(r.stderr).toMatch(/another LSR run \(pid \d+\)/)
                expect(fs.readFileSync(lockOf(root), "utf8")).toBe(String(process.pid))
            } finally { fs.unlinkSync(lockOf(root)) }
        })
        it("no source file was changed by any of the above", () => {
            expect(snapshotTree(root)).toEqual(pristine)
        })
    })

    describe("full non-detect run and resume", () => {
        let first: RunResult
        beforeAll(() => {
            fs.rmSync(path.join(root, "tmp"), { recursive: true, force: true })
            first = lsr(["--root", root, "--stages", NON_DETECT])
        })

        it("exits 0 and runs the stages in canonical order", () => {
            expect(first.code).toBe(0)
            expect(stagesDone(first.stdout)).toEqual(["scan", "hash", "index", "duplicates"])
        })
        it("scans every media file, skipping non-media and nested tmp/", () => {
            expect(first.stdout).toMatch(/stage scan done in \S+: 3 folders, 5 media/)
            const rows = query(root, "select localPath, contentMd5, hasAudio, kind from media order by localPath")
            expect(rows.map(r => path.relative(root, r.localPath))).toEqual(["a.png", "b.png", "sub/a-copy.png", "sub/deep/c.png", "v.mp4"])
            expect(rows.every(r => typeof r.contentMd5 === "string" && r.contentMd5.length === 32)).toBe(true)
            expect(rows.find(r => r.localPath.endsWith("v.mp4")).hasAudio).toBe(1)
        })
        it("finds the exact duplicate pair", () => {
            expect(first.stdout).toMatch(/stage duplicates done in \S+: 1 duplicate groups/)
            const rows = query(root, "select d.groupId, m.localPath from items_duplicated d join media m on m.id = d.mediaId order by m.localPath")
            expect(rows.map(r => path.relative(root, r.localPath))).toEqual(["a.png", "sub/a-copy.png"])
            expect(new Set(rows.map(r => r.groupId)).size).toBe(1)
        })
        it("writes a run log with the summary and releases the lock", () => {
            const logs = logsOf(root)
            expect(logs).toHaveLength(1)
            const text = fs.readFileSync(path.join(root, "tmp", "logs", logs[0]), "utf8")
            expect(text).toMatch(/==== LSR summary ====/)
            expect(text).toMatch(/exit code 0/)
            expect(first.stdout).toContain(path.join(root, "tmp", "logs", logs[0]))
            expect(fs.existsSync(lockOf(root))).toBe(false)
        })
        it("reports 0 errors and 0 warnings", () => {
            expect(first.stdout).toMatch(/total\s+\S+\s+0 errors, 0 warnings logged/)
            expect(first.stderr).toBe("")
        })
        it("moved, deleted or changed no media file", () => {
            expect(snapshotTree(root)).toEqual(pristine)
        })
        it("a re-run resumes: nothing left to hash, same results, a second log", () => {
            const before = query(root, "select id, contentMd5, updatedAt from media order by id")
            const second = lsr(["--root", root, "--stages", NON_DETECT])
            expect(second.code).toBe(0)
            expect(second.stdout).toMatch(/stage hash done in \S+: 0 of 0 unhashed files hashed/)
            expect(second.stdout).toMatch(/1 duplicate groups/)
            const after = query(root, "select id, contentMd5, updatedAt from media order by id")
            expect(after.map(r => [r.id, r.contentMd5])).toEqual(before.map(r => [r.id, r.contentMd5]))
            expect(logsOf(root)).toHaveLength(2)
            expect(snapshotTree(root)).toEqual(pristine)
        })
    })

    describe("--stages subsetting", () => {
        it("runs only the selected stages, in canonical order whatever the given order", () => {
            const r = lsr(["--root", root, "--stages", "duplicates,scan"])
            expect(r.code).toBe(0)
            expect(stagesDone(r.stdout)).toEqual(["scan", "duplicates"])
            expect(r.stdout).toMatch(/stages: scan, duplicates/)
            expect(r.stdout).toMatch(/\[1\/2 scan/)
            expect(r.stdout).toMatch(/\[2\/2 duplicates/)
            expect(r.stdout).not.toMatch(/\bhash\b.*hashed/)
            const summary = r.stdout.slice(r.stdout.indexOf("==== LSR summary ===="))
            expect(summary).toMatch(/^\s+scan\s/m)
            expect(summary).toMatch(/^\s+duplicates\s/m)
            expect(summary).not.toMatch(/^\s+(hash|index|detect)\s/m)
        })
        it("a single stage works on its own", () => {
            const r = lsr(["--root", root, "--stages", "hash"])
            expect(r.code).toBe(0)
            expect(stagesDone(r.stdout)).toEqual(["hash"])
        })
        it("a hash-only run on a never-scanned root finishes with nothing to do", () => {
            const fresh = path.join(base, "fresh")
            fs.mkdirSync(fresh)
            fs.copyFileSync(path.join(root, "a.png"), path.join(fresh, "x.png"))
            const r = lsr(["--root", fresh, "--stages", "hash"])
            expect(r.code).toBe(0)
            expect(r.stdout).toMatch(/0 of 0 unhashed files hashed/)
        })
    })

    describe("failures", () => {
        it("an unreadable folder is logged and gives exit 1, other media still scanned", () => {
            const r2 = path.join(base, "unreadable")
            fs.mkdirSync(path.join(r2, "locked"), { recursive: true })
            fs.copyFileSync(path.join(root, "a.png"), path.join(r2, "ok.png"))
            fs.copyFileSync(path.join(root, "b.png"), path.join(r2, "locked", "hidden.png"))
            fs.chmodSync(path.join(r2, "locked"), 0o000)
            try {
                const r = lsr(["--root", r2, "--stages", "scan"])
                expect(r.code).toBe(1)
                expect(r.stderr).toMatch(/cannot read folder .*locked/)
                expect(r.stdout).toMatch(/1 unreadable folders/)
                expect(r.stdout).toMatch(/1 errors, 0 warnings logged/)
            } finally { fs.chmodSync(path.join(r2, "locked"), 0o755) }
        })
        it("a corrupt index.db -> exit 3, lock released, media untouched", () => {
            const r3 = path.join(base, "corrupt")
            fs.mkdirSync(path.join(r3, "tmp", "hashIndex"), { recursive: true })
            fs.copyFileSync(path.join(root, "a.png"), path.join(r3, "a.png"))
            fs.writeFileSync(path.join(r3, "tmp", "hashIndex", "index.db"), "this is not a sqlite database".repeat(200))
            const before = snapshotTree(r3)
            const r = lsr(["--root", r3, "--stages", "scan,hash"])
            expect(r.code).toBe(3)
            expect(r.stderr).toMatch(/fatal|failed/)
            expect(fs.existsSync(lockOf(r3))).toBe(false)
            expect(logsOf(r3)).toHaveLength(1)
            expect(snapshotTree(r3)).toEqual(before)
        })
    })


    // cli/fakeDetector.ts: only with NODE_ENV=test AND LSR_FAKE_DETECTOR=1.
    describe("detect stage with the fake detector, and detection resume", () => {
        const FAKE = { NODE_ENV: "test", LSR_FAKE_DETECTOR: "1" }
        let fakeMaloi: string
        let dr: string
        const detectedItems = (r: string): string[] => query(r, "select distinct itemId from item_detection order by itemId").map(x => x.itemId)
        beforeAll(() => {
            fakeMaloi = path.join(base, "fake-detector.maloi")
            fs.writeFileSync(fakeMaloi, JSON.stringify({ onnx: "does-not-exist.onnx", classes: "x,y" }))
            dr = path.join(base, "detect")
            makeFixture(dr)
        })

        it("is ignored without NODE_ENV=test: missing ONNX -> exit 2", () => {
            const r = lsr(["--root", dr, "--maloi", fakeMaloi, "--stages", "detect"], { NODE_ENV: "production", LSR_FAKE_DETECTOR: "1" })
            expect(r.code).toBe(2)
            expect(r.stderr).toMatch(/ONNX model not found/)
            expect(r.stderr).not.toMatch(/fake test detector/)
        })
        it("is ignored without LSR_FAKE_DETECTOR=1", () => {
            const r = lsr(["--root", dr, "--maloi", fakeMaloi, "--stages", "detect"], { NODE_ENV: "test", LSR_FAKE_DETECTOR: "" })
            expect(r.code).toBe(2)
            expect(r.stderr).toMatch(/ONNX model not found/)
        })
        it("first run detects every item, including each video frame item", () => {
            const r = lsr(["--root", dr, "--maloi", fakeMaloi, "--stages", "scan,hash,index,detect"], FAKE)
            expect(r.code).toBe(0)
            expect(r.stderr).toMatch(/WARN .*fake test detector/)
            expect(stagesDone(r.stdout)).toEqual(["scan", "hash", "index", "detect"])
            expect(r.stdout).toMatch(/stage detect done in \S+: 5 media processed, 0 failed/)
            const expected = query(dr, "select distinct itemId from media_item order by itemId").map(x => x.itemId)
            const videoId = query(dr, "select id from media where filename = 'v.mp4'")[0].id
            expect(expected.filter(i => i.startsWith(`${videoId}_`)).length).toBeGreaterThanOrEqual(2)
            expect(detectedItems(dr)).toEqual(expected)
        })
        it("second and third detect runs process nothing (video frames are not re-detected)", () => {
            const before = query(dr, "select count(*) n from item_detection")[0].n
            for (let i = 0; i < 2; i++) {
                const r = lsr(["--root", dr, "--maloi", fakeMaloi, "--stages", "detect"], FAKE)
                expect(r.code).toBe(0)
                expect(r.stdout).toMatch(/stage detect done in \S+: 0 media processed, 0 failed/)
            }
            expect(query(dr, "select count(*) n from item_detection")[0].n).toBe(before)
        })
        it("a new media file is the only one detected on the next run", () => {
            ffmpeg("-f", "lavfi", "-i", "testsrc=s=20x20", "-frames:v", "1", path.join(dr, "new.png"))
            const r = lsr(["--root", dr, "--maloi", fakeMaloi, "--stages", "scan,detect"], FAKE)
            expect(r.code).toBe(0)
            expect(r.stdout).toMatch(/: 1 media processed, 0 failed/)
        })
        it("the full chain including duplicates exits 0 and leaves media untouched", () => {
            const before = snapshotTree(dr)
            const r = lsr(["--root", dr, "--maloi", fakeMaloi], FAKE)
            expect(r.code).toBe(0)
            expect(stagesDone(r.stdout)).toEqual(["scan", "hash", "index", "detect", "duplicates", "extraDups"])
            expect(snapshotTree(dr)).toEqual(before)
        })
        it("resume works past the 400-id lookup chunk", () => {
            const many = path.join(base, "many")
            fs.mkdirSync(many)
            // 450 distinct frames (testsrc draws a changing pattern per frame)
            ffmpeg("-f", "lavfi", "-i", "testsrc=s=16x16:r=1:d=450", path.join(many, "f%03d.png"))
            expect(fs.readdirSync(many).length).toBe(450)
            const first = lsr(["--root", many, "--maloi", fakeMaloi, "--stages", "scan,detect"], FAKE)
            expect(first.code).toBe(0)
            const processed = Number(/stage detect done in \S+: (\d+) media processed/.exec(first.stdout)![1])
            expect(processed).toBe(450)
            expect(detectedItems(many).length).toBeGreaterThan(400)
            const second = lsr(["--root", many, "--maloi", fakeMaloi, "--stages", "detect"], FAKE)
            expect(second.code).toBe(0)
            expect(second.stdout).toMatch(/: 0 media processed, 0 failed/)
        })
    })


    // E3: paged index, bucketed duplicates, stop between pages/buckets.
    describe("scale + resume: interrupting index and duplicates", () => {
        let pr: string
        const dupGroups = (r: string): string[][] => {
            const rows = query(r, "select d.groupId, m.localPath from items_duplicated d join media m on m.id = d.mediaId")
            const by = new Map<string, string[]>()
            for (const x of rows) { if (!by.has(x.groupId)) by.set(x.groupId, []); by.get(x.groupId)!.push(path.relative(r, x.localPath)) }
            return [...by.values()].map(g => g.sort()).sort((a, b) => a[0].localeCompare(b[0]))
        }
        const interruptAt = async (args: string[], linePattern: RegExp): Promise<RunResult> => {
            const run = lsrAsync(args)
            await waitFor(() => linePattern.test(run.output()))
            run.child.kill("SIGINT")
            return run.done
        }
        beforeAll(() => {
            // 800 distinct frames + an exact copy of each: few, large blur buckets,
            // so both index (paged by 500) and duplicates take long enough to interrupt.
            pr = path.join(base, "pairs")
            fs.mkdirSync(path.join(pr, "a"), { recursive: true })
            fs.mkdirSync(path.join(pr, "b"), { recursive: true })
            ffmpeg("-f", "lavfi", "-i", "testsrc2=s=64x48:r=1:d=800", path.join(pr, "a", "f%04d.png"))
            for (const f of fs.readdirSync(path.join(pr, "a"))) fs.copyFileSync(path.join(pr, "a", f), path.join(pr, "b", f))
            const r = lsr(["--root", pr, "--stages", "scan,hash"])
            if (r.code !== 0) throw new Error(r.stdout + r.stderr)
        })

        it("SIGINT during index -> exit 130, '(stopped early)', and a re-run completes", async () => {
            const pristinePairs = snapshotTree(pr)
            const r = await interruptAt(["--root", pr, "--stages", "index"], /\[1\/1 index/)
            expect(r.code).toBe(130)
            const line = /stage index done in \S+: (\d+) media checked(.*)$/m.exec(r.stdout)
            expect(line).not.toBeNull()
            expect(line![2]).toMatch(/\(stopped early\)/)
            expect(Number(line![1])).toBeLessThan(1600)
            expect(fs.existsSync(lockOf(pr))).toBe(false)

            const again = lsr(["--root", pr, "--stages", "index"])
            expect(again.code).toBe(0)
            expect(again.stdout).toMatch(/stage index done in \S+: 1600 media checked$/m)
            expect(snapshotTree(pr)).toEqual(pristinePairs)
        })

        let firstGroups: string[][]
        it("duplicates run pairs every copy with its original", () => {
            const r = lsr(["--root", pr, "--stages", "duplicates"])
            expect(r.code).toBe(0)
            firstGroups = dupGroups(pr)
            const all = firstGroups.flat()
            // every a/fNNNN.png is grouped with b/fNNNN.png
            for (const f of fs.readdirSync(path.join(pr, "a"))) {
                const g = firstGroups.find(x => x.includes(`a/${f}`))
                expect(g).toBeDefined()
                expect(g).toContain(`b/${f}`)
            }
            expect(new Set(all).size).toBe(all.length)
        })

        it("SIGINT during duplicates -> exit 130, '(stopped early)', previous groups kept; a re-run updates them", async () => {
            // A new copy that a completed scan would add to an existing group.
            fs.copyFileSync(path.join(pr, "a", "f0001.png"), path.join(pr, "extra-f0001.png"))
            const prep = lsr(["--root", pr, "--stages", "scan,hash,index"])
            expect(prep.code).toBe(0)
            const pristinePairs = snapshotTree(pr)

            const r = await interruptAt(["--root", pr, "--stages", "duplicates"], /\[1\/1 duplicates/)
            expect(r.code).toBe(130)
            expect(r.stdout).toMatch(/stage duplicates done in \S+: .*\(stopped early\)/)
            expect(dupGroups(pr)).toEqual(firstGroups)
            expect(dupGroups(pr).flat()).not.toContain("extra-f0001.png")

            const again = lsr(["--root", pr, "--stages", "duplicates"])
            expect(again.code).toBe(0)
            expect(again.stdout).not.toMatch(/stopped early/)
            const g = dupGroups(pr).find(x => x.includes("a/f0001.png"))
            expect(g).toEqual(expect.arrayContaining(["a/f0001.png", "b/f0001.png", "extra-f0001.png"]))
            expect(snapshotTree(pr)).toEqual(pristinePairs)
        })

        it("GUI wrapper findIndexDuplicates == the old all-rows algorithm == what the CLI persisted", () => {
            // Old algorithm (HEAD~ duplicateFinder.findIndexDuplicates) re-implemented over
            // HashStore.allBaseGreyRows, run in the same Electron process as the new wrapper.
            const dist = path.join(REPO, "electron-dist")
            const script = `
                const path = require("path");
                require(${JSON.stringify(path.join(REPO, "electron-dist", "DirectorioCache.js"))}).setActiveFolder(${JSON.stringify(pr)});
                const HashStore = require(path.join(${JSON.stringify(dist)}, "compareImg", "HashStore.js"));
                const finder = require(path.join(${JSON.stringify(dist)}, "compareImg", "duplicateFinder.js"));
                const norm = gs => gs.map(g => [...g].sort()).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
                (async () => {
                    HashStore.ensureReady();
                    const rows = HashStore.allBaseGreyRows();
                    const parent = new Map();
                    const find = x => { if (!parent.has(x)) parent.set(x, x); while (parent.get(x) !== x) x = parent.get(x); return x; };
                    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
                    const matched = new Set();
                    const buckets = new Map();
                    for (const r of rows) { const k = r.baseMd5Blur ?? ""; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(r); }
                    const mad = (a, b) => { if (a.length !== b.length) return Infinity; let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
                    for (const b of buckets.values()) for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
                        const x = b[i], y = b[j]; if (x.mediaId === y.mediaId) continue;
                        if ((x.contentMd5 && x.contentMd5 === y.contentMd5) || (x.baseMd5 && x.baseMd5 === y.baseMd5) || mad(x.baseGrey, y.baseGrey) <= 3) { matched.add(x.mediaId); matched.add(y.mediaId); union(x.mediaId, y.mediaId); }
                    }
                    const g = new Map(); for (const id of matched) { const r = find(id); if (!g.has(r)) g.set(r, []); g.get(r).push(id); }
                    const oldGroups = norm([...g.values()].filter(x => x.length > 1));
                    const newGroups = norm(await finder.findIndexDuplicates());
                    process.stdout.write(JSON.stringify({ oldGroups, newGroups }));
                    HashStore.closeConnection();
                })().catch(e => { console.error(e); process.exit(1); });`
            const r = spawnSync(ELECTRON, ["-e", script], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
            expect(r.stderr).not.toMatch(/Error/)
            expect(r.status).toBe(0)
            const jsonStart = r.stdout.lastIndexOf('{"oldGroups"')
            const { oldGroups, newGroups } = JSON.parse(r.stdout.slice(jsonStart))
            expect(newGroups.length).toBeGreaterThan(0)
            expect(newGroups).toEqual(oldGroups)
            const persisted = query(pr, "select groupId, mediaId from items_duplicated")
            const by = new Map<string, string[]>()
            for (const x of persisted) { if (!by.has(x.groupId)) by.set(x.groupId, []); by.get(x.groupId)!.push(x.mediaId) }
            const persistedNorm = [...by.values()].map(g => g.sort()).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
            expect(persistedNorm).toEqual(newGroups)
        })
    })

    describe("detect on a never-indexed root with a video", () => {
        it("warns that videos have no frames yet, still exits 0, and only the image gets detections", () => {
            const n = path.join(base, "noindex")
            fs.mkdirSync(n)
            fs.copyFileSync(path.join(root, "v.mp4"), path.join(n, "v.mp4"))
            fs.copyFileSync(path.join(root, "a.png"), path.join(n, "a.png"))
            const m = path.join(base, "noindex.maloi")
            fs.writeFileSync(m, JSON.stringify({ onnx: "x.onnx", classes: "x" }))
            const r = lsr(["--root", n, "--maloi", m, "--stages", "scan,detect"], { NODE_ENV: "test", LSR_FAKE_DETECTOR: "1" })
            expect(r.code).toBe(0)
            expect(r.stderr).toMatch(/WARN .*1 video\/GIF media have no extracted frames/)
            expect(r.stdout).toMatch(/stage detect done in \S+: 1 media processed, 0 failed, 0 already detected, 1 videos\/GIFs without frames skipped/)
            const items = query(n, "select distinct itemId from item_detection").map(x => x.itemId)
            const imageId = query(n, "select id from media where filename = 'a.png'")[0].id
            expect(items).toEqual([imageId])
        })
    })


    // 22075c3: an item is done only for the same model AND class list.
    describe("detection done-state is per model and class list", () => {
        const FAKE = { NODE_ENV: "test", LSR_FAKE_DETECTOR: "1" }
        let r5: string
        let m: string
        const detect = () => lsr(["--root", r5, "--maloi", m, "--stages", "detect"], FAKE)
        const processed = (out: string) => Number(/stage detect done in \S+: (\d+) media processed/.exec(out)![1])
        beforeAll(() => {
            r5 = path.join(base, "modelstate")
            makeFixture(r5)
            m = path.join(base, "modelstate.maloi")
            fs.writeFileSync(m, JSON.stringify({ onnx: "x.onnx", classes: "x" }))
            const first = lsr(["--root", r5, "--maloi", m, "--stages", "scan,hash,index,detect"], FAKE)
            if (first.code !== 0) throw new Error(first.stdout + first.stderr)
            expect(processed(first.stdout)).toBe(5)
        })
        it("records model and class list for every detected item", () => {
            const rows = query(r5, "select s.itemId, s.classList, p.* from item_detection_state s left join model_path p on p.id = s.modelPathId")
            const items = query(r5, "select distinct itemId from media_item").map(x => x.itemId).sort()
            expect(rows.map(x => x.itemId).sort()).toEqual(items)
            expect(new Set(rows.map(x => x.classList))).toEqual(new Set(["fake-a,fake-b"]))
            expect(JSON.stringify(rows)).toMatch(/lsr-fake-detector\.onnx/)
        })
        it("the same fake run again processes 0", () => {
            const r = detect()
            expect(r.code).toBe(0)
            expect(processed(r.stdout)).toBe(0)
        })
        it("state alone marks an item done, even with no boxes stored (zero-box items are skipped)", () => {
            execSql(r5, "DELETE FROM item_detection")
            expect(processed(detect().stdout)).toBe(0)
        })
        it("a different class list re-detects every item", () => {
            execSql(r5, "UPDATE item_detection_state SET classList = 'other,list'")
            const r = detect()
            expect(r.code).toBe(0)
            expect(processed(r.stdout)).toBe(5)
            expect(new Set(query(r5, "select classList from item_detection_state").map(x => x.classList))).toEqual(new Set(["fake-a,fake-b"]))
            expect(processed(detect().stdout)).toBe(0)
        })
        it("a different model re-detects every item", () => {
            execSql(r5, "INSERT INTO model_path (path) SELECT '/other/model.onnx' WHERE NOT EXISTS (SELECT 1 FROM model_path WHERE path = '/other/model.onnx'); " +
                "UPDATE item_detection_state SET modelPathId = (SELECT id FROM model_path WHERE path = '/other/model.onnx')")
            expect(processed(detect().stdout)).toBe(5)
            expect(processed(detect().stdout)).toBe(0)
        })
        it("old state rows with NULL model/class list count as not done (re-detected once)", () => {
            execSql(r5, "UPDATE item_detection_state SET modelPathId = NULL, classList = NULL")
            expect(processed(detect().stdout)).toBe(5)
            expect(processed(detect().stdout)).toBe(0)
        })
        it("only the changed items are re-detected", () => {
            const vid = query(r5, "select id from media where filename = 'v.mp4'")[0].id
            execSql(r5, `UPDATE item_detection_state SET classList = 'stale' WHERE itemId LIKE '${vid}\\_%' ESCAPE '\\'`)
            expect(processed(detect().stdout)).toBe(1)
        })
    })

    describe("symlinks and special files", () => {
        it("are skipped and counted; nothing hangs", () => {
            const r6 = path.join(base, "links")
            fs.mkdirSync(path.join(r6, "real"), { recursive: true })
            fs.copyFileSync(path.join(root, "a.png"), path.join(r6, "real", "a.png"))
            fs.symlinkSync(path.join(r6, "real", "a.png"), path.join(r6, "link-to-file.png"))
            fs.symlinkSync(r6, path.join(r6, "real", "loop")) // folder symlink back up: a cycle
            fs.symlinkSync(path.join(r6, "nowhere.png"), path.join(r6, "dangling.png"))
            const fifo = spawnSync("mkfifo", [path.join(r6, "pipe.png")])
            expect(fifo.status).toBe(0)
            const before = snapshotTreeNoSpecial(r6)
            const r = spawnSync(ELECTRON, [CLI, "--root", r6, "--stages", "scan,hash,index"], { env, encoding: "utf8", timeout: 30_000 })
            expect(r.signal).toBeNull() // not killed by the timeout
            expect(r.status).toBe(0)
            expect(r.stdout).toMatch(/2 folders, 1 media, 3 symlinks skipped, 1 special files skipped/)
            expect(r.stderr).toMatch(/WARN .*pipe\.png/)
            expect(query(r6, "select filename from media").map(x => x.filename)).toEqual(["a.png"])
            expect(fs.lstatSync(path.join(r6, "pipe.png")).isFIFO()).toBe(true)
            expect(snapshotTreeNoSpecial(r6)).toEqual(before)
        })
    })

    describe("stage failure (exit 3) vs item failures (exit 1)", () => {
        it("index failing on every item is item-level: exit 1, errors counted, later stages still run", () => {
            const r7 = path.join(base, "failidx")
            fs.mkdirSync(r7)
            fs.copyFileSync(path.join(root, "a.png"), path.join(r7, "a.png"))
            fs.copyFileSync(path.join(root, "b.png"), path.join(r7, "b.png"))
            expect(lsr(["--root", r7, "--stages", "scan,hash"]).code).toBe(0)
            execSql(r7, "CREATE TRIGGER lsr_test_block BEFORE INSERT ON items BEGIN SELECT RAISE(ABORT, 'lsr test: items unwritable'); END;")
            const r = lsr(["--root", r7, "--stages", "index,duplicates"])
            expect(r.code).toBe(1)
            expect(r.stderr).toMatch(/failed to index image .*a\.png: lsr test: items unwritable/)
            expect(r.stdout).toMatch(/stage index done in \S+: 2 media checked, 2 failed; 2 errors logged/)
            expect(stagesDone(r.stdout)).toEqual(["index", "duplicates"])
            expect(fs.existsSync(lockOf(r7))).toBe(false)
        })
        it.each([[4, 1], [5, 3]])("index with all %d items failing -> exit %d (system-wide threshold is 5)", (n, code) => {
            const rx = path.join(base, `failall${n}`)
            fs.mkdirSync(rx)
            const frames = path.join(rx, "f%02d.png")
            ffmpeg("-f", "lavfi", "-i", `testsrc2=s=32x24:r=1:d=${n}`, frames)
            expect(fs.readdirSync(rx).length).toBe(n)
            expect(lsr(["--root", rx, "--stages", "scan,hash"]).code).toBe(0)
            execSql(rx, "CREATE TRIGGER lsr_test_block BEFORE INSERT ON items BEGIN SELECT RAISE(ABORT, 'lsr test: items unwritable'); END;")
            const r = lsr(["--root", rx, "--stages", "index,duplicates"])
            expect(r.code).toBe(code)
            if (code === 3) {
                expect(r.stderr).toMatch(/stage index failed.*every one of the 5 items the index stage tried failed/s)
                expect(stagesDone(r.stdout)).toEqual([])
                expect(r.stdout).not.toMatch(/\[2\/2 duplicates/)
            } else {
                expect(r.stdout).toMatch(new RegExp(`${n} media checked, ${n} failed; ${n} errors logged`))
                expect(stagesDone(r.stdout)).toEqual(["index", "duplicates"])
            }
            expect(fs.existsSync(lockOf(rx))).toBe(false)
        })
        it("partial failure (1 of 6 items) stays item-level: exit 1, later stages run", () => {
            const rp = path.join(base, "failpartial")
            fs.mkdirSync(rp)
            ffmpeg("-f", "lavfi", "-i", "testsrc2=s=32x24:r=1:d=6", path.join(rp, "f%02d.png"))
            expect(lsr(["--root", rp, "--stages", "scan,hash"]).code).toBe(0)
            const bad = query(rp, "select id from media where filename = 'f03.png'")[0].id
            execSql(rp, `CREATE TRIGGER lsr_test_block BEFORE INSERT ON items WHEN NEW.id = '${bad}' BEGIN SELECT RAISE(ABORT, 'lsr test: one item unwritable'); END;`)
            const r = lsr(["--root", rp, "--stages", "index,duplicates"])
            expect(r.code).toBe(1)
            expect(r.stdout).toMatch(/6 media checked, 1 failed; 1 errors logged/)
            expect(r.stderr).toMatch(/f03\.png: lsr test: one item unwritable/)
            expect(stagesDone(r.stdout)).toEqual(["index", "duplicates"])
            expect(query(rp, "select count(*) n from items")[0].n).toBe(5)
        })
        it.each([[4, 1], [5, 3]])("hash with all %d files unreadable -> exit %d", (n, code) => {
            const rh = path.join(base, `hashunreadable${n}`)
            fs.mkdirSync(rh)
            ffmpeg("-f", "lavfi", "-i", `testsrc2=s=32x24:r=1:d=${n}`, path.join(rh, "f%02d.png"))
            expect(lsr(["--root", rh, "--stages", "scan"]).code).toBe(0)
            const files = fs.readdirSync(rh).filter(f => f.endsWith(".png")).map(f => path.join(rh, f))
            for (const f of files) fs.chmodSync(f, 0o000)
            try {
                const r = lsr(["--root", rh, "--stages", "hash,index"])
                expect(r.code).toBe(code)
                if (code === 3) {
                    expect(r.stdout).toMatch(/hash\s+\S+\s+FAILED: every one of the 5 items/)
                    expect(r.stderr).toMatch(/every one of the 5 items the hash stage tried failed/)
                    expect(stagesDone(r.stdout)).toEqual([])
                    expect(r.stdout).not.toMatch(/\[2\/2 index/)
                } else {
                    // documented exit 1 = "finished, but some items failed"
                    expect(r.stdout).toMatch(new RegExp(`0 of ${n} unhashed files hashed, ${n} unreadable`))
                    expect(r.stdout).toMatch(new RegExp(`${n} errors`))
                    expect(stagesDone(r.stdout)).toEqual(["hash", "index"])
                }
                expect(fs.existsSync(lockOf(rh))).toBe(false)
            } finally { for (const f of files) fs.chmodSync(f, 0o644) }
        })
        it("duplicates unable to persist its groups -> stage FAILED, exit 3, lock released, media untouched", () => {
            const r8 = path.join(base, "faildup")
            fs.mkdirSync(path.join(r8, "s"), { recursive: true })
            fs.copyFileSync(path.join(root, "a.png"), path.join(r8, "a.png"))
            fs.copyFileSync(path.join(root, "a.png"), path.join(r8, "s", "a-copy.png"))
            expect(lsr(["--root", r8, "--stages", "scan,hash,index"]).code).toBe(0)
            execSql(r8, "CREATE TRIGGER lsr_test_block BEFORE INSERT ON items_duplicated BEGIN SELECT RAISE(ABORT, 'lsr test: groups unwritable'); END;")
            const before = snapshotTree(r8)
            const r = lsr(["--root", r8, "--stages", "duplicates"])
            expect(r.code).toBe(3)
            expect(r.stderr).toMatch(/stage duplicates failed.*lsr test: groups unwritable/s)
            expect(r.stdout + r.stderr).toMatch(/duplicates\s+\S+\s+FAILED/)
            expect(stagesDone(r.stdout)).toEqual([])
            expect(fs.existsSync(lockOf(r8))).toBe(false)
            const log = fs.readFileSync(path.join(r8, "tmp", "logs", logsOf(r8).pop()!), "utf8")
            expect(log).toMatch(/exit code 3/)
            expect(snapshotTree(r8)).toEqual(before)
        })
        it("a stage failure stops the chain: stages after it do not run", () => {
            const r8 = path.join(base, "faildup")
            const r = lsr(["--root", r8, "--stages", "duplicates"].concat([]))
            expect(r.code).toBe(3)
            const r2 = lsr(["--root", r8, "--stages", "scan,hash,index,duplicates"])
            expect(r2.code).toBe(3)
            expect(stagesDone(r2.stdout)).toEqual(["scan", "hash", "index"])
        })
    })


    // Follow-up to 22075c3: done/undone is decided per MEDIA; detect indexes unindexed media itself.
    describe("detect: per-media redo and indexing inside detect", () => {
        const FAKE = { NODE_ENV: "test", LSR_FAKE_DETECTOR: "1" }
        let m: string
        beforeAll(() => {
            m = path.join(base, "permedia.maloi")
            fs.writeFileSync(m, JSON.stringify({ onnx: "x.onnx", classes: "x" }))
        })
        it("one undone frame re-runs inference for that frame only; the rest are replayed untouched", async () => {
            const r9 = path.join(base, "permedia")
            makeFixture(r9)
            const first = lsr(["--root", r9, "--maloi", m, "--stages", "scan,hash,index,detect"], FAKE)
            expect(first.code).toBe(0)
            const vid = query(r9, "select id from media where filename = 'v.mp4'")[0].id
            const frames = () => query(r9, `select itemId, detectedAt from item_detection where itemId like '${vid}_%' order by itemId`)
            const before = frames()
            expect(before.length).toBeGreaterThanOrEqual(2)
            const target = before.find(x => x.itemId.endsWith("_pct10")) ?? before[0]
            const others = () => frames().filter(x => x.itemId !== target.itemId)
            const othersBefore = others()
            const imagesBefore = query(r9, `select itemId, detectedAt from item_detection where itemId not like '${vid}_%' order by itemId`)
            await new Promise(r => setTimeout(r, 1100)) // detectedAt may be second-resolution
            execSql(r9, `DELETE FROM item_detection_state WHERE itemId = '${target.itemId}'`)
            const r = lsr(["--root", r9, "--maloi", m, "--stages", "detect"], FAKE)
            expect(r.code).toBe(0)
            expect(r.stdout).toMatch(/stage detect done in \S+: 1 media processed, 0 failed, 4 already detected/)
            const after = frames()
            expect(after.find(x => x.itemId === target.itemId).detectedAt).toBeGreaterThan(target.detectedAt)
            expect(others()).toEqual(othersBefore)
            expect(query(r9, `select itemId, detectedAt from item_detection where itemId not like '${vid}_%' order by itemId`)).toEqual(imagesBefore)
            expect(query(r9, `select count(*) n from item_detection_state where itemId = '${target.itemId}'`)[0].n).toBe(1)
            const again = lsr(["--root", r9, "--maloi", m, "--stages", "detect"], FAKE)
            expect(again.stdout).toMatch(/: 0 media processed, 0 failed, 5 already detected/)
        })
        it("scan,hash,detect without the index stage detects videos in the same run", () => {
            const r10 = path.join(base, "noindexstage")
            makeFixture(r10)
            const r = lsr(["--root", r10, "--maloi", m, "--stages", "scan,hash,detect"], FAKE)
            expect(r.code).toBe(0)
            expect(r.stdout).toMatch(/stage detect done in \S+: 5 media processed, 0 failed, 0 already detected$/m)
            expect(r.stderr).not.toMatch(/no extracted frames/)
            const vid = query(r10, "select id from media where filename = 'v.mp4'")[0].id
            const items = query(r10, "select distinct itemId from item_detection_state").map(x => x.itemId)
            expect(items.filter(i => i.startsWith(`${vid}_`)).length).toBeGreaterThanOrEqual(2)
            expect(items).toEqual(expect.arrayContaining(query(r10, "select distinct itemId from media_item").map(x => x.itemId)))
            const again = lsr(["--root", r10, "--maloi", m, "--stages", "scan,hash,detect"], FAKE)
            expect(again.stdout).toMatch(/: 0 media processed, 0 failed, 5 already detected$/m)
        })
    })

    describe("stall watchdog", () => {
        it("no progress for LSR_STALL_MINUTES -> 'stalled', exit 3, lock released", () => {
            // a.png is hashed, then swapped for a FIFO: index blocks reading it
            // (in the threadpool, so timers still run) and never progresses.
            const rs = path.join(base, "stall")
            fs.mkdirSync(rs)
            fs.copyFileSync(path.join(root, "a.png"), path.join(rs, "a.png"))
            expect(lsr(["--root", rs, "--stages", "scan,hash"]).code).toBe(0)
            fs.unlinkSync(path.join(rs, "a.png"))
            expect(spawnSync("mkfifo", [path.join(rs, "a.png")]).status).toBe(0)
            const started = Date.now()
            const r = spawnSync(ELECTRON, [CLI, "--root", rs, "--stages", "index"], { env: { ...env, LSR_STALL_MINUTES: "0.02" }, encoding: "utf8", timeout: 60_000 })
            expect(r.signal).toBeNull()
            expect(r.status).toBe(3)
            expect(Date.now() - started).toBeLessThan(30_000)
            expect(r.stderr).toMatch(/stalled: .*no progress for \S+ \(LSR_STALL_MINUTES=0\.02\)/)
            expect(r.stderr).toMatch(/files in progress: .*a\.png/)
            expect(fs.existsSync(lockOf(rs))).toBe(false)
            const log = fs.readFileSync(path.join(rs, "tmp", "logs", logsOf(rs).pop()!), "utf8")
            expect(log).toMatch(/stalled/)
            expect(log).toMatch(/exiting \(exit code 3\)/)
        })
        it("a healthy run with a short stall limit is not killed", () => {
            const r = lsr(["--root", root, "--stages", "scan,hash,index,duplicates"], { LSR_STALL_MINUTES: "0.05" })
            expect(r.code).toBe(0)
            expect(r.stderr).not.toMatch(/stalled/)
        })
    })


    // Fake-detector poison hooks (cli/fakeDetector.ts): escaped errors name the in-flight file.
    describe("errors that escape every handler", () => {
        const FAKE = { NODE_ENV: "test", LSR_FAKE_DETECTOR: "1" }
        let m: string
        const poisonRoot = (name: string, poison: string): string => {
            const r = path.join(base, name)
            fs.mkdirSync(r)
            fs.copyFileSync(path.join(root, "a.png"), path.join(r, "ok.png"))
            fs.copyFileSync(path.join(root, "b.png"), path.join(r, `x${poison}.png`))
            return r
        }
        const lastLog = (r: string) => fs.readFileSync(path.join(r, "tmp", "logs", logsOf(r).pop()!), "utf8")
        beforeAll(() => {
            m = path.join(base, "poison.maloi")
            fs.writeFileSync(m, JSON.stringify({ onnx: "x.onnx", classes: "x" }))
        })

        it("poison hooks are inert without NODE_ENV=test (real detector required -> exit 2)", () => {
            const r = poisonRoot("poison-inert", "__lsr_throw__")
            const out = lsr(["--root", r, "--maloi", m, "--stages", "scan,hash,detect"], { NODE_ENV: "production", LSR_FAKE_DETECTOR: "1" })
            expect(out.code).toBe(2)
            expect(out.stderr).not.toMatch(/uncaught exception/)
        })
        it("unhandled rejection: logged with the file in progress, run continues, exit 1", () => {
            const r = poisonRoot("poison-reject", "__lsr_reject__")
            const before = snapshotTree(r)
            const out = lsr(["--root", r, "--maloi", m, "--stages", "scan,hash,detect,duplicates"], FAKE)
            expect(out.code).toBe(1)
            expect(out.stderr).toMatch(/unhandled rejection: .*x__lsr_reject__\.png/)
            const log = lastLog(r)
            expect(log).toMatch(/files in progress: .*x__lsr_reject__\.png/)
            expect(out.stdout).toMatch(/stage detect done in \S+: 2 media processed, 0 failed.*1 errors logged/)
            expect(stagesDone(out.stdout)).toEqual(["scan", "hash", "detect", "duplicates"])
            expect(out.stdout).toMatch(/exit code 1/)
            expect(fs.existsSync(lockOf(r))).toBe(false)
            expect(snapshotTree(r)).toEqual(before)
        })
        it("uncaught exception: fatal line names the file, exit 3, no graceful summary, lock released", () => {
            const r = poisonRoot("poison-throw", "__lsr_throw__")
            const before = snapshotTree(r)
            const out = lsr(["--root", r, "--maloi", m, "--stages", "scan,hash,detect,duplicates"], FAKE)
            expect(out.code).toBe(3)
            expect(out.stderr).toMatch(/uncaught exception: .*x__lsr_throw__\.png/)
            expect(out.stderr).toMatch(/files in progress: .*x__lsr_throw__\.png.* - exiting \(exit code 3\)/s)
            expect(out.stdout).not.toMatch(/==== LSR summary ====/)
            expect(out.stdout).not.toMatch(/\[\d\/4 duplicates/)
            expect(fs.existsSync(lockOf(r))).toBe(false)
            const lines = lastLog(r).trim().split("\n")
            expect(lines[lines.length - 1]).toMatch(/exiting \(exit code 3\)/)
            expect(snapshotTree(r)).toEqual(before)
        })
        it("a promise that never settles: watchdog -> 'stalled', file named, exit 3, lock released", () => {
            const r = poisonRoot("poison-hang", "__lsr_hang__")
            const started = Date.now()
            const out = spawnSync(ELECTRON, [CLI, "--root", r, "--maloi", m, "--stages", "scan,hash,detect"],
                { env: { ...env, ...FAKE, LSR_STALL_MINUTES: "0.02" }, encoding: "utf8", timeout: 60_000 })
            expect(out.signal).toBeNull()
            expect(out.status).toBe(3)
            expect(Date.now() - started).toBeLessThan(30_000)
            expect(out.stderr).toMatch(/stalled: .*no progress for \S+ \(LSR_STALL_MINUTES=0\.02\)/)
            expect(out.stderr).toMatch(/files in progress: .*x__lsr_hang__\.png/)
            expect(fs.existsSync(lockOf(r))).toBe(false)
            expect(lastLog(r)).toMatch(/stalled/)
        })
        it("a normal run exits promptly despite the ref'd watchdog interval (default 30m limit)", () => {
            const r = poisonRoot("poison-none", "-clean")
            const env2 = { ...FAKE, LSR_STALL_MINUTES: "" }
            const started = Date.now()
            const out = lsr(["--root", r, "--maloi", m], env2)
            expect(out.signal).toBeNull()
            expect(out.code).toBe(0)
            expect(Date.now() - started).toBeLessThan(15_000)
            expect(out.stdout).toMatch(/==== LSR summary ====/)
        })
    })


    // Prior work counts as success; failed files are listed in the summary; detection writes are atomic.
    describe("re-runs after partial success, failed-file listing, atomic detection writes", () => {
        const FAKE = { NODE_ENV: "test", LSR_FAKE_DETECTOR: "1" }
        const frames = (dir: string, n: number, prefix: string, size = "32x24") =>
            ffmpeg("-f", "lavfi", "-i", `testsrc2=s=${size}:r=1:d=${n}`, path.join(dir, `${prefix}%02d.png`))
        const summaryOf = (out: string) => out.slice(out.indexOf("==== LSR summary ===="))

        it("hash: 5 new unreadable files after 10 hashed earlier -> exit 1 (not FAILED), files listed", () => {
            const rh = path.join(base, "rerun-hash")
            fs.mkdirSync(rh)
            frames(rh, 10, "old")
            expect(lsr(["--root", rh, "--stages", "scan,hash"]).code).toBe(0)
            frames(rh, 5, "new", "40x30")
            expect(lsr(["--root", rh, "--stages", "scan"]).code).toBe(0)
            const bad = fs.readdirSync(rh).filter(f => f.startsWith("new")).map(f => path.join(rh, f))
            for (const f of bad) fs.chmodSync(f, 0o000)
            try {
                const r = lsr(["--root", rh, "--stages", "hash"])
                expect(r.code).toBe(1)
                expect(r.stdout).toMatch(/0 of 5 unhashed files hashed, 5 unreadable/)
                const summary = summaryOf(r.stdout)
                expect(summary).toMatch(/failed files \(5\):/)
                for (const f of bad) expect(summary).toContain(f)
                expect(summary).not.toMatch(/and \d+ more/)
            } finally { for (const f of bad) fs.chmodSync(f, 0o644) }
        })
        it("index: 5 new failing items after 6 indexed earlier -> exit 1, files listed", () => {
            const ri = path.join(base, "rerun-index")
            fs.mkdirSync(ri)
            frames(ri, 6, "old")
            expect(lsr(["--root", ri, "--stages", "scan,hash,index"]).code).toBe(0)
            frames(ri, 5, "new", "40x30")
            expect(lsr(["--root", ri, "--stages", "scan,hash"]).code).toBe(0)
            execSql(ri, "CREATE TRIGGER lsr_test_block BEFORE INSERT ON items BEGIN SELECT RAISE(ABORT, 'lsr test: items unwritable'); END;")
            const r = lsr(["--root", ri, "--stages", "index,duplicates"])
            expect(r.code).toBe(1)
            expect(r.stdout).toMatch(/11 media checked, 5 failed; 5 errors logged/)
            expect(stagesDone(r.stdout)).toEqual(["index", "duplicates"])
            const summary = summaryOf(r.stdout)
            expect(summary).toMatch(/failed files \(5\):/)
            for (let i = 1; i <= 5; i++) expect(summary).toContain(path.join(ri, `new0${i}.png`))
        })
        it("a FAILED stage still lists its failed files, capped at 20 with '... and N more'", () => {
            const rc = path.join(base, "cap-list")
            fs.mkdirSync(rc)
            frames(rc, 25, "f")
            expect(lsr(["--root", rc, "--stages", "scan"]).code).toBe(0)
            const files = fs.readdirSync(rc).filter(f => f.endsWith(".png")).map(f => path.join(rc, f))
            for (const f of files) fs.chmodSync(f, 0o000)
            try {
                const r = lsr(["--root", rc, "--stages", "hash"])
                expect(r.code).toBe(3)
                const summary = summaryOf(r.stdout)
                expect(summary).toMatch(/hash\s+\S+\s+FAILED: every one of the 25 items/)
                expect(summary).toMatch(/failed files \(25\):/)
                const listed = files.filter(f => summary.includes(f))
                expect(listed).toHaveLength(20)
                expect(summary).toMatch(/\.\.\. and 5 more \(see the log\)/)
                // the log has every one
                const log = fs.readFileSync(path.join(rc, "tmp", "logs", logsOf(rc).pop()!), "utf8")
                for (const f of files) expect(log).toContain(f)
            } finally { for (const f of files) fs.chmodSync(f, 0o644) }
        })
        it.each(["pct10", "pct50"])("a failing video frame (_%s) does not wipe the boxes of another frame that stays 'done'", (pos) => {
            const rv = path.join(base, `vfail-${pos}`)
            fs.mkdirSync(rv)
            fs.copyFileSync(path.join(root, "v.mp4"), path.join(rv, "v.mp4"))
            const m = path.join(base, "vfail.maloi")
            fs.writeFileSync(m, JSON.stringify({ onnx: "x.onnx", classes: "x" }))
            expect(lsr(["--root", rv, "--maloi", m, "--stages", "scan,hash,index,detect"], FAKE).code).toBe(0)
            const vid = query(rv, "select id from media")[0].id
            const failing = `${vid}_${pos}`
            execSql(rv, `DELETE FROM item_detection_state WHERE itemId = '${failing}';` +
                `CREATE TRIGGER lsr_test_block BEFORE INSERT ON item_detection_state WHEN NEW.itemId = '${failing}' BEGIN SELECT RAISE(ABORT, 'lsr test: state unwritable'); END;`)
            const r = lsr(["--root", rv, "--maloi", m, "--stages", "detect"], FAKE)
            expect(r.code).toBe(1)
            // Every frame still marked done must keep its (fake: exactly 1) box.
            const doneFrames = query(rv, "select s.itemId, (select count(*) from item_detection d where d.itemId = s.itemId) boxes from item_detection_state s")
            expect(doneFrames.length).toBeGreaterThanOrEqual(1)
            for (const f of doneFrames) expect({ itemId: f.itemId, boxes: f.boxes }).toEqual({ itemId: f.itemId, boxes: 1 })
        })
        it("detection boxes and done-state are written in one transaction (a failed state write leaves no new boxes)", () => {
            const rt = path.join(base, "atomic")
            fs.mkdirSync(rt)
            frames(rt, 3, "f")
            const m = path.join(base, "atomic.maloi")
            fs.writeFileSync(m, JSON.stringify({ onnx: "x.onnx", classes: "x" }))
            expect(lsr(["--root", rt, "--maloi", m, "--stages", "scan,hash,index,detect"], FAKE).code).toBe(0)
            const target = query(rt, "select id from media where filename = 'f02.png'")[0].id
            const boxesBefore = query(rt, `select * from item_detection where itemId = '${target}'`)
            expect(boxesBefore.length).toBe(1)
            // Make the box rows distinguishable, then force a redo whose state write fails.
            execSql(rt, `UPDATE item_detection SET detectedAt = 1, score = 0.123 WHERE itemId = '${target}';` +
                `DELETE FROM item_detection_state WHERE itemId = '${target}';` +
                `CREATE TRIGGER lsr_test_block BEFORE INSERT ON item_detection_state WHEN NEW.itemId = '${target}' BEGIN SELECT RAISE(ABORT, 'lsr test: state unwritable'); END;`)
            const marked = query(rt, `select * from item_detection where itemId = '${target}'`)
            const r = lsr(["--root", rt, "--maloi", m, "--stages", "detect"], FAKE)
            expect(r.code).toBe(1)
            expect(r.stdout).toMatch(/1 media processed, 1 failed, 2 already detected/)
            expect(r.stderr).toMatch(/lsr test: state unwritable/)
            expect(summaryOf(r.stdout)).toContain(path.join(rt, "f02.png"))
            // Rolled back: never NEW boxes without a state row. (The error handler then
            // clears the failed item's boxes, which is consistent: no boxes, not done.)
            const after = query(rt, `select * from item_detection where itemId = '${target}'`)
            expect(after.length === 0 || JSON.stringify(after) === JSON.stringify(marked)).toBe(true)
            expect(query(rt, `select count(*) n from item_detection_state where itemId = '${target}'`)[0].n).toBe(0)
            // once writable again, the next run redoes it
            execSql(rt, "DROP TRIGGER lsr_test_block")
            const again = lsr(["--root", rt, "--maloi", m, "--stages", "detect"], FAKE)
            expect(again.code).toBe(0)
            expect(again.stdout).toMatch(/1 media processed, 0 failed, 2 already detected/)
            expect(query(rt, `select detectedAt from item_detection where itemId = '${target}'`)[0].detectedAt).toBeGreaterThan(1)
        })
    })


    // Reviewer B1 scenario + detect re-run with permanently failing files (964ee1f).
    describe("permanently bad files never fail a re-run", () => {
        const FAKE = { NODE_ENV: "test", LSR_FAKE_DETECTOR: "1" }
        it("6 unreadable of 9: both the first run and the re-run are exit 1, all stages run, files listed", () => {
            const rb = path.join(base, "b1")
            fs.mkdirSync(rb)
            ffmpeg("-f", "lavfi", "-i", "testsrc2=s=32x24:r=1:d=9", path.join(rb, "f%02d.png"))
            expect(lsr(["--root", rb, "--stages", "scan"]).code).toBe(0)
            const bad = ["f01", "f02", "f03", "f04", "f05", "f06"].map(n => path.join(rb, `${n}.png`))
            for (const f of bad) fs.chmodSync(f, 0o000)
            try {
                const args = ["--root", rb, "--stages", "scan,hash,index,duplicates"]
                const first = lsr(args)
                expect(first.code).toBe(1)
                expect(first.stdout).toMatch(/3 of 9 unhashed files hashed, 6 unreadable; 6 errors logged/)
                expect(stagesDone(first.stdout)).toEqual(["scan", "hash", "index", "duplicates"])
                const second = lsr(args)
                expect(second.code).toBe(1)
                expect(second.stdout).toMatch(/0 of 6 unhashed files hashed, 6 unreadable/)
                expect(second.stdout).not.toMatch(/FAILED/)
                expect(stagesDone(second.stdout)).toEqual(["scan", "hash", "index", "duplicates"])
                const summary = second.stdout.slice(second.stdout.indexOf("==== LSR summary ===="))
                expect(summary).toMatch(/failed files \(6\):/)
                for (const f of bad) expect(summary).toContain(f)
            } finally { for (const f of bad) fs.chmodSync(f, 0o644) }
        })
        it("detect: 6 items failing (POISON_FAIL) next to 3 good: exit 1 on both runs, re-run counts earlier work", () => {
            const rd = path.join(base, "b1-detect")
            fs.mkdirSync(rd)
            ffmpeg("-f", "lavfi", "-i", "testsrc2=s=32x24:r=1:d=3", path.join(rd, "good%02d.png"))
            ffmpeg("-f", "lavfi", "-i", "testsrc2=s=40x30:r=1:d=6", path.join(rd, "x__lsr_fail__%02d.png"))
            const m = path.join(base, "b1.maloi")
            fs.writeFileSync(m, JSON.stringify({ onnx: "x.onnx", classes: "x" }))
            const args = ["--root", rd, "--maloi", m, "--stages", "scan,hash,index,detect,duplicates"]
            const first = lsr(args, FAKE)
            expect(first.code).toBe(1)
            expect(first.stdout).toMatch(/stage detect done in \S+: 9 media processed, 6 failed, 0 already detected/)
            expect(stagesDone(first.stdout)).toEqual(["scan", "hash", "index", "detect", "duplicates"])
            const second = lsr(args, FAKE)
            expect(second.code).toBe(1)
            expect(second.stdout).toMatch(/stage detect done in \S+: 6 media processed, 6 failed, 3 already detected/)
            expect(second.stdout).not.toMatch(/FAILED/)
            expect(stagesDone(second.stdout)).toEqual(["scan", "hash", "index", "detect", "duplicates"])
            const summary = second.stdout.slice(second.stdout.indexOf("==== LSR summary ===="))
            expect(summary).toMatch(/failed files \(6\):/)
            expect((summary.match(/x__lsr_fail__\d\d\.png/g) || []).length).toBe(6)
        })
        it("detect: 6 failing and nothing ever succeeded -> FAILED, exit 3", () => {
            const rd = path.join(base, "b1-detect-all")
            fs.mkdirSync(rd)
            ffmpeg("-f", "lavfi", "-i", "testsrc2=s=40x30:r=1:d=6", path.join(rd, "x__lsr_fail__%02d.png"))
            const m = path.join(base, "b1.maloi")
            const r = lsr(["--root", rd, "--maloi", m, "--stages", "scan,hash,index,detect,duplicates"], FAKE)
            expect(r.code).toBe(3)
            expect(r.stdout).toMatch(/detect\s+\S+\s+FAILED: every one of the 6 items the detect stage tried failed/)
            expect(stagesDone(r.stdout)).toEqual(["scan", "hash", "index"])
        })
    })

    // E4: the extraDups stage (GUI's other three algorithms, each in a child process).
    describe("extraDups stage", () => {
        const FAKE = { NODE_ENV: "test", LSR_FAKE_DETECTOR: "1" }
        let m: string
        let slow: string
        beforeAll(() => {
            m = path.join(base, "xd.maloi")
            fs.writeFileSync(m, JSON.stringify({ onnx: "x.onnx", classes: "x" }))
            // 400 byte-identical copies: identical fake boxes -> the objects query is very slow.
            slow = path.join(base, "xd-slow")
            fs.mkdirSync(slow)
            for (let i = 0; i < 400; i++) fs.copyFileSync(path.join(root, "b.png"), path.join(slow, `c${i}.png`))
            const prep = lsr(["--root", slow, "--maloi", m, "--stages", "scan,hash,index,detect"], FAKE)
            if (prep.code !== 0) throw new Error(prep.stdout + prep.stderr)
        })

        it("runs objects, frames and blurFrames on the fake-detector fixture, persists nothing, exit 0", () => {
            const rx = path.join(base, "xd-small")
            makeFixture(rx)
            const prep = lsr(["--root", rx, "--maloi", m, "--stages", "scan,hash,index,detect,duplicates"], FAKE)
            expect(prep.code).toBe(0)
            const dupBefore = query(rx, "select * from items_duplicated order by groupId, mediaId")
            const before = snapshotTree(rx)
            const r = lsr(["--root", rx, "--stages", "extraDups"], FAKE)
            expect(r.code).toBe(0)
            expect(r.stdout).toMatch(/stage extraDups done in \S+: objects: \d+ groups, frames: \d+ groups, blurFrames: \d+ groups$/m)
            // a.png and sub/a-copy.png are byte-identical: identical fake boxes -> at least one objects group
            expect(Number(/objects: (\d+) groups/.exec(r.stdout)![1])).toBeGreaterThanOrEqual(1)
            expect(query(rx, "select * from items_duplicated order by groupId, mediaId")).toEqual(dupBefore)
            expect(extraChildrenOf(rx)).toEqual([])
            expect(snapshotTree(rx)).toEqual(before)
        })
        it("over budget (LSR_EXTRA_DUPS_MINUTES=0.01): objects FAILED (timed out), others still run, exit 1, child killed", () => {
            const started = Date.now()
            const r = lsr(["--root", slow, "--stages", "extraDups"], { ...FAKE, LSR_EXTRA_DUPS_MINUTES: "0.01" })
            expect(r.code).toBe(1)
            expect(Date.now() - started).toBeLessThan(20_000)
            expect(r.stdout).toMatch(/objects: FAILED \(timed out after \S+ \(LSR_EXTRA_DUPS_MINUTES\)\), frames: \d+ groups, blurFrames: \d+ groups; 1 errors logged/)
            expect(r.stderr).toMatch(/lsr extraDups: objects failed - timed out/)
            expect(extraChildrenOf(slow)).toEqual([])
            expect(fs.existsSync(lockOf(slow))).toBe(false)
        })
        it("SIGINT during extraDups -> exit 130 promptly, no child left", async () => {
            const run = lsrAsync(["--root", slow, "--stages", "extraDups"])
            await waitFor(() => /\[1\/1 extraDups/.test(run.output()))
            await waitFor(() => extraChildrenOf(slow).length > 0, 10_000)
            await new Promise(r => setTimeout(r, 300))
            const sent = Date.now()
            run.child.kill("SIGINT")
            const r = await run.done
            expect(r.code).toBe(130)
            expect(Date.now() - sent).toBeLessThan(5_000)
            expect(r.stdout).toMatch(/stage extraDups done in \S+: .*\(stopped early\)/)
            expect(r.stdout).toMatch(/exit code 130/)
            await new Promise(res => setTimeout(res, 200))
            expect(extraChildrenOf(slow)).toEqual([])
            expect(fs.existsSync(lockOf(slow))).toBe(false)
        })
        it("a forced second SIGINT also kills the child", async () => {
            const run = lsrAsync(["--root", slow, "--stages", "extraDups"])
            await waitFor(() => extraChildrenOf(slow).length > 0, 10_000)
            run.child.kill("SIGINT")
            await waitFor(() => /SIGINT received/.test(run.output()))
            run.child.kill("SIGINT")
            const r = await run.done
            expect(r.code).toBe(130)
            await new Promise(res => setTimeout(res, 200))
            expect(extraChildrenOf(slow)).toEqual([])
            expect(fs.existsSync(lockOf(slow))).toBe(false)
        })
        it("SIGKILL of the runner (no exit handlers run): the child notices and kills itself within 3s", async () => {
            const run = lsrAsync(["--root", slow, "--stages", "extraDups"])
            await waitFor(() => extraChildrenOf(slow).length > 0, 10_000)
            run.child.kill("SIGKILL")
            await run.done
            await waitFor(() => extraChildrenOf(slow).length === 0, 3_000).catch(() => undefined)
            const orphans = extraChildrenOf(slow)
            // clean up regardless, so later tests are not disturbed
            for (const l of orphans) { try { process.kill(Number(l.trim().split(/\s+/)[0]), "SIGKILL") } catch { /* gone */ } }
            fs.rmSync(lockOf(slow), { force: true })
            expect(orphans).toEqual([])
        })
    })

    describe("interruption", () => {
        let big: string
        let bigPristine: Record<string, string>
        beforeAll(() => {
            // 60 folders x 50 files: the scan polls the stop flag between folders.
            big = path.join(base, "big")
            const png = fs.readFileSync(path.join(root, "b.png"))
            for (let f = 0; f < 60; f++) {
                const dir = path.join(big, `f${String(f).padStart(2, "0")}`)
                fs.mkdirSync(dir, { recursive: true })
                for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(dir, `img${i}.png`), png)
            }
            bigPristine = snapshotTree(big)
        })

        it("SIGINT stops gracefully with exit 130, releases the lock, and a re-run completes", async () => {
            const run = lsrAsync(["--root", big, "--stages", "scan"])
            await waitFor(() => /\[1\/1 scan\]/.test(run.output()))
            run.child.kill("SIGINT")
            const r = await run.done
            expect(r.code).toBe(130)
            expect(r.stderr).toMatch(/SIGINT received: stopping/)
            expect(r.stdout).toMatch(/interrupted - re-run the same command to continue/)
            expect(r.stdout).toMatch(/exit code 130/)
            // The stop really landed mid-scan (not after a scan that had already finished).
            const partial = /stage scan done in \S+: (\d+) folders, (\d+) media/.exec(r.stdout)
            expect(partial).not.toBeNull()
            expect(Number(partial![2])).toBeLessThan(3000)
            expect(fs.existsSync(lockOf(big))).toBe(false)
            const logText = fs.readFileSync(path.join(big, "tmp", "logs", logsOf(big)[0]), "utf8")
            expect(logText).toMatch(/exit code 130/)

            const again = lsr(["--root", big, "--stages", "scan"])
            expect(again.code).toBe(0)
            expect(again.stdout).toMatch(/61 folders, 3000 media/)
            expect(snapshotTree(big)).toEqual(bigPristine)
        })

        it("SIGTERM is handled like SIGINT", async () => {
            const run = lsrAsync(["--root", big, "--stages", "scan"])
            await waitFor(() => /\[1\/1 scan\]/.test(run.output()))
            run.child.kill("SIGTERM")
            const r = await run.done
            expect(r.code).toBe(130)
            expect(r.stderr).toMatch(/SIGTERM received/)
            expect(fs.existsSync(lockOf(big))).toBe(false)
        })

        it("a second signal exits at once with 130, releases the lock, and logs a last sync line", async () => {
            // Distinct frames, scanned+hashed but not indexed: an index page of 500 takes
            // seconds, so the second signal reliably lands while the first stop is pending.
            const slow = path.join(base, "slowidx")
            fs.mkdirSync(slow)
            ffmpeg("-f", "lavfi", "-i", "testsrc2=s=64x48:r=1:d=600", path.join(slow, "f%04d.png"))
            expect(lsr(["--root", slow, "--stages", "scan,hash"]).code).toBe(0)
            const slowPristine = snapshotTree(slow)
            const run = lsrAsync(["--root", slow, "--stages", "index"])
            await waitFor(() => /\[1\/1 index/.test(run.output()))
            run.child.kill("SIGINT")
            await waitFor(() => /SIGINT received/.test(run.output()))
            run.child.kill("SIGINT")
            const r = await run.done
            expect(r.code).toBe(130)
            expect(r.stderr).toMatch(/second SIGINT: exiting immediately \(exit code 130\)/)
            expect(r.stdout).not.toMatch(/==== LSR summary ====/) // forced: no graceful summary
            expect(fs.existsSync(lockOf(slow))).toBe(false)
            const newest = path.join(slow, "tmp", "logs", logsOf(slow).pop()!)
            const lines = fs.readFileSync(newest, "utf8").trim().split("\n")
            expect(lines[lines.length - 1]).toMatch(/second SIGINT/)
            const again = lsr(["--root", slow, "--stages", "index"])
            expect(again.code).toBe(0)
            expect(again.stdout).toMatch(/600 media checked$/m)
            expect(snapshotTree(slow)).toEqual(slowPristine)
        })
    })
})
