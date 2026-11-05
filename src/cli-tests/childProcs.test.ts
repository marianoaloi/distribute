/**
 * @jest-environment node
 */
// system/childProcs.ts - registry of live child processes, SIGKILLed on runner exit.
import { spawn, ChildProcess } from "child_process"
import { killAll, liveCount, track } from "../../system/childProcs"

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true } catch { return false } }
const exited = (c: ChildProcess) => new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(r => c.once("exit", (code, signal) => r({ code, signal })))

afterEach(() => { killAll() })

describe("childProcs", () => {
    it("tracks a running child and SIGKILLs it in killAll", async () => {
        const c = track(spawn("sleep", ["30"]))
        expect(liveCount()).toBe(1)
        const done = exited(c)
        expect(killAll()).toBe(1)
        expect(liveCount()).toBe(0)
        expect((await done).signal).toBe("SIGKILL")
        expect(alive(c.pid!)).toBe(false)
    })
    it("returns the same child (chainable)", () => {
        const c = spawn("sleep", ["30"])
        expect(track(c)).toBe(c)
    })
    it("forgets a child that exits on its own", async () => {
        const c = track(spawn("true"))
        await exited(c)
        expect(liveCount()).toBe(0)
        expect(killAll()).toBe(0)
    })
    it("forgets a child that fails to spawn", async () => {
        const c = track(spawn("/definitely/not/a/binary"))
        await new Promise(r => c.once("error", r))
        expect(liveCount()).toBe(0)
    })
    it("kills a child that ignores SIGTERM", async () => {
        const c = track(spawn("sh", ["-c", "trap '' TERM; sleep 30"]))
        await new Promise(r => setTimeout(r, 100))
        c.kill("SIGTERM")
        await new Promise(r => setTimeout(r, 100))
        expect(alive(c.pid!)).toBe(true)
        const done = exited(c)
        expect(killAll()).toBe(1)
        expect((await done).signal).toBe("SIGKILL")
    })
    it("kills several and clears the registry", async () => {
        const cs = [1, 2, 3].map(() => track(spawn("sleep", ["30"])))
        expect(liveCount()).toBe(3)
        const all = Promise.all(cs.map(exited))
        expect(killAll()).toBe(3)
        await all
        expect(cs.every(c => !alive(c.pid!))).toBe(true)
        expect(killAll()).toBe(0)
    })
})
