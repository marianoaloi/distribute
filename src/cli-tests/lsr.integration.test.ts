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

const logsOf = (root: string): string[] => {
    const dir = path.join(root, "tmp", "logs")
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^lsr-\d{8}-\d{6}(-\d+)?\.log$/.test(f)).sort() : []
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
            expect(stagesDone(r.stdout)).toEqual(["scan", "hash", "index", "detect", "duplicates"])
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
            expect(r.stderr).toMatch(/1 video\/GIF media have no extracted frames yet .* run the index stage first/)
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

    describe("stage failure (exit 3)", () => {
        it("an index stage that cannot write items -> FAILED, exit 3, later stages not run, lock released", () => {
            const r7 = path.join(base, "failidx")
            fs.mkdirSync(r7)
            fs.copyFileSync(path.join(root, "a.png"), path.join(r7, "a.png"))
            fs.copyFileSync(path.join(root, "b.png"), path.join(r7, "b.png"))
            const prep = lsr(["--root", r7, "--stages", "scan,hash"])
            expect(prep.code).toBe(0)
            execSql(r7, "CREATE TRIGGER lsr_test_block BEFORE INSERT ON items BEGIN SELECT RAISE(ABORT, 'lsr test: items unwritable'); END;")
            const before = snapshotTree(r7)
            const r = lsr(["--root", r7, "--stages", "index,duplicates"])
            expect(r.code).toBe(3)
            expect(r.stderr).toMatch(/stage index failed/)
            expect(r.stdout + r.stderr).toMatch(/index\s+\S+\s+FAILED/)
            expect(stagesDone(r.stdout)).toEqual([])
            expect(r.stdout).not.toMatch(/\[2\/2 duplicates/)
            expect(fs.existsSync(lockOf(r7))).toBe(false)
            expect(snapshotTree(r7)).toEqual(before)
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
            const run = lsrAsync(["--root", big, "--stages", "scan,hash,index"])
            await waitFor(() => /\[1\/3 scan\]/.test(run.output()))
            run.child.kill("SIGINT")
            await waitFor(() => /SIGINT received/.test(run.output()))
            run.child.kill("SIGINT")
            const r = await run.done
            expect(r.code).toBe(130)
            expect(r.stderr).toMatch(/second SIGINT: exiting immediately \(exit code 130\)/)
            // the forced exit releases the lock and writes its last log line synchronously
            expect(fs.existsSync(lockOf(big))).toBe(false)
            const newest = logsOf(big).map(f => path.join(big, "tmp", "logs", f)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs).pop()!
            const lines = fs.readFileSync(newest, "utf8").trim().split("\n")
            expect(lines[lines.length - 1]).toMatch(/second SIGINT/)
            const again = lsr(["--root", big, "--stages", "scan"])
            expect(again.code).toBe(0)
            expect(fs.existsSync(lockOf(big))).toBe(false)
            expect(snapshotTree(big)).toEqual(bigPristine)
        })
    })
})
