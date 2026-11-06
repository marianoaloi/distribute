// cli/signals.ts - graceful first stop, hard exit on the second signal.
import { EventEmitter } from "events"
import { EXIT_INTERRUPTED, installStopHandlers } from "../../cli/signals"

const fakeProc = () => {
    const em = new EventEmitter() as EventEmitter & { exit: jest.Mock }
    em.exit = jest.fn()
    return em
}

describe("installStopHandlers", () => {
    it("is not stopped initially", () => {
        const proc = fakeProc()
        const s = installStopHandlers(() => undefined, proc as any)
        expect(s.shouldStop()).toBe(false)
        expect(s.reason()).toBeNull()
    })
    it.each(["SIGINT", "SIGTERM"])("first %s sets the flag and calls onFirst once, without exiting", (sig) => {
        const proc = fakeProc()
        const onFirst = jest.fn()
        const s = installStopHandlers(onFirst, proc as any)
        proc.emit(sig, sig)
        expect(s.shouldStop()).toBe(true)
        expect(s.reason()).toBe(sig)
        expect(onFirst).toHaveBeenCalledTimes(1)
        expect(onFirst).toHaveBeenCalledWith(sig)
        expect(proc.exit).not.toHaveBeenCalled()
    })
    it("a second signal (any kind) exits with 130 and keeps the first reason", () => {
        const proc = fakeProc()
        const onFirst = jest.fn()
        const s = installStopHandlers(onFirst, proc as any)
        proc.emit("SIGTERM", "SIGTERM")
        proc.emit("SIGINT", "SIGINT")
        expect(EXIT_INTERRUPTED).toBe(130)
        expect(proc.exit).toHaveBeenCalledWith(130)
        expect(onFirst).toHaveBeenCalledTimes(1)
        expect(s.reason()).toBe("SIGTERM")
    })
    it("dispose removes both listeners", () => {
        const proc = fakeProc()
        const s = installStopHandlers(() => undefined, proc as any)
        expect(proc.listenerCount("SIGINT")).toBe(1)
        expect(proc.listenerCount("SIGTERM")).toBe(1)
        s.dispose()
        expect(proc.listenerCount("SIGINT")).toBe(0)
        expect(proc.listenerCount("SIGTERM")).toBe(0)
        proc.emit("SIGINT", "SIGINT")
        expect(s.shouldStop()).toBe(false)
    })
    it("onForced runs synchronously before exit(130) on the second signal only", () => {
        const proc = fakeProc()
        const order: string[] = []
        proc.exit.mockImplementation(() => { order.push("exit") })
        installStopHandlers(() => order.push("first"), proc as any, (sig) => order.push(`forced:${sig}`))
        proc.emit("SIGINT", "SIGINT")
        expect(order).toEqual(["first"])
        proc.emit("SIGTERM", "SIGTERM")
        expect(order).toEqual(["first", "forced:SIGTERM", "exit"])
        expect(proc.exit).toHaveBeenCalledWith(130)
    })
    it("a throwing onForced still exits with 130", () => {
        const proc = fakeProc()
        installStopHandlers(() => undefined, proc as any, () => { throw new Error("disk full") })
        proc.emit("SIGINT", "SIGINT")
        expect(() => proc.emit("SIGINT", "SIGINT")).not.toThrow()
        expect(proc.exit).toHaveBeenCalledWith(130)
    })
})
