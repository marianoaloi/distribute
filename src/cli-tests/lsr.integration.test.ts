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

        it("a second signal exits at once with 130; the stale lock is taken over by the next run", async () => {
            const run = lsrAsync(["--root", big, "--stages", "scan,hash,index"])
            await waitFor(() => /\[1\/3 scan\]/.test(run.output()))
            run.child.kill("SIGINT")
            await waitFor(() => /SIGINT received/.test(run.output()))
            run.child.kill("SIGINT")
            const r = await run.done
            expect(r.code).toBe(130)
            const again = lsr(["--root", big, "--stages", "scan"])
            expect(again.code).toBe(0)
            expect(fs.existsSync(lockOf(big))).toBe(false)
            expect(snapshotTree(big)).toEqual(bigPristine)
        })
    })
})
