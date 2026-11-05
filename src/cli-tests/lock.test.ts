// cli/lock.ts - one LSR run per media root via <root>/tmp/lsr.lock.
import fs from "fs"
import os from "os"
import path from "path"
import { acquireLock, lockPathFor } from "../../cli/lock"

const DEAD_PID = 2 ** 22 + 12345 // above Linux's pid_max ceiling (2^22)
let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "lsr-lock-")) })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const lockFile = () => lockPathFor(root)
const must = (r: ReturnType<typeof acquireLock>) => { if (!r.ok) throw new Error(r.error); return r }

describe("acquireLock", () => {
    it("lives at <root>/tmp/lsr.lock and creates tmp/", () => {
        expect(lockFile()).toBe(path.join(root, "tmp", "lsr.lock"))
        const l = must(acquireLock(root, process.pid))
        expect(fs.readFileSync(lockFile(), "utf8")).toBe(String(process.pid))
        l.release()
        expect(fs.existsSync(lockFile())).toBe(false)
    })
    it("refuses when a live different pid holds it", () => {
        // process.ppid (the jest worker's parent) is alive and != our pid argument.
        fs.mkdirSync(path.dirname(lockFile()), { recursive: true })
        fs.writeFileSync(lockFile(), String(process.ppid))
        const r = acquireLock(root, process.pid)
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.error).toMatch(new RegExp(`another LSR run \\(pid ${process.ppid}\\)`))
        expect(fs.readFileSync(lockFile(), "utf8")).toBe(String(process.ppid))
    })
    it("a second acquire by another live holder is refused while the first holds it", () => {
        const first = must(acquireLock(root, process.pid))
        expect(acquireLock(root, process.ppid).ok).toBe(false)
        first.release()
        expect(acquireLock(root, process.ppid).ok).toBe(true)
    })
    it("takes over a stale lock from a dead pid", () => {
        fs.mkdirSync(path.dirname(lockFile()), { recursive: true })
        fs.writeFileSync(lockFile(), String(DEAD_PID))
        must(acquireLock(root, process.pid))
        expect(fs.readFileSync(lockFile(), "utf8")).toBe(String(process.pid))
    })
    it.each(["garbage", "", "-5", "0"])("takes over a lock with unusable content %p", (content) => {
        fs.mkdirSync(path.dirname(lockFile()), { recursive: true })
        fs.writeFileSync(lockFile(), content)
        must(acquireLock(root, process.pid))
        expect(fs.readFileSync(lockFile(), "utf8")).toBe(String(process.pid))
    })
    it("re-acquires a lock already holding our own pid", () => {
        fs.mkdirSync(path.dirname(lockFile()), { recursive: true })
        fs.writeFileSync(lockFile(), String(process.pid))
        must(acquireLock(root, process.pid))
    })
    it("release does not delete a lock taken over by someone else", () => {
        const l = must(acquireLock(root, process.pid))
        fs.writeFileSync(lockFile(), String(process.ppid))
        l.release()
        expect(fs.readFileSync(lockFile(), "utf8")).toBe(String(process.ppid))
    })
    it("release is safe when the lock file is already gone", () => {
        const l = must(acquireLock(root, process.pid))
        fs.unlinkSync(lockFile())
        expect(() => l.release()).not.toThrow()
    })
})
