// mediaDb/paging.ts - keyset page loop (pure).
import { DEFAULT_PAGE_SIZE, forEachPage, Page } from "../../mediaDb/paging"

// A fake table of rowids 1..n (with optional gaps) paged by "rowid > after".
const table = (rowids: number[]) => {
    const calls: Array<[number, number]> = []
    const fetch = (after: number, limit: number): Page<number> => {
        calls.push([after, limit])
        const rows = rowids.filter(r => r > after).slice(0, limit)
        return { rows, next: rows.length ? rows[rows.length - 1] : after }
    }
    return { fetch, calls }
}
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

describe("forEachPage", () => {
    it("visits every row once, in order, page by page", async () => {
        const { fetch, calls } = table(range(1203))
        const seen: number[] = []
        const r = await forEachPage(fetch, rows => { seen.push(...rows) })
        expect(seen).toEqual(range(1203))
        expect(r).toEqual({ pages: 3, rows: 1203, stopped: false })
        expect(calls.map(c => c[1])).toEqual([DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE])
        expect(calls.map(c => c[0])).toEqual([0, 500, 1000, 1203])
    })
    it("default page size is 500", () => expect(DEFAULT_PAGE_SIZE).toBe(500))
    it("handles cursor gaps and an exact multiple of the page size", async () => {
        const ids = [3, 7, 8, 20, 21, 50]
        const { fetch } = table(ids)
        const pages: number[][] = []
        const r = await forEachPage(fetch, rows => { pages.push(rows) }, { pageSize: 2 })
        expect(pages).toEqual([[3, 7], [8, 20], [21, 50]])
        expect(r).toEqual({ pages: 3, rows: 6, stopped: false })
    })
    it("an empty table gives zero pages", async () => {
        const visit = jest.fn()
        expect(await forEachPage(table([]).fetch, visit)).toEqual({ pages: 0, rows: 0, stopped: false })
        expect(visit).not.toHaveBeenCalled()
    })
    it("starts after options.start (resume)", async () => {
        const seen: number[] = []
        await forEachPage(table(range(10)).fetch, rows => { seen.push(...rows) }, { pageSize: 3, start: 6 })
        expect(seen).toEqual([7, 8, 9, 10])
    })
    it("awaits async visits before fetching the next page", async () => {
        const log: string[] = []
        const { fetch } = table(range(4))
        const wrapped = (a: number, l: number) => { log.push(`fetch${a}`); return fetch(a, l) }
        await forEachPage(wrapped, async rows => { await new Promise(r => setTimeout(r, 5)); log.push(`done${rows[0]}`) }, { pageSize: 2 })
        expect(log).toEqual(["fetch0", "done1", "fetch2", "done3", "fetch4"])
    })
    it("shouldStop before the first fetch fetches nothing", async () => {
        const { fetch, calls } = table(range(10))
        const r = await forEachPage(fetch, () => undefined, { shouldStop: () => true })
        expect(r).toEqual({ pages: 0, rows: 0, stopped: true })
        expect(calls).toEqual([])
    })
    it("shouldStop raised during a page lets that page finish, then stops", async () => {
        let stop = false
        const seen: number[] = []
        const r = await forEachPage(table(range(10)).fetch, rows => { seen.push(...rows); if (rows.includes(4)) stop = true }, { pageSize: 2, shouldStop: () => stop })
        expect(seen).toEqual([1, 2, 3, 4])
        expect(r).toEqual({ pages: 2, rows: 4, stopped: true })
    })
    it("not stopped when shouldStop only becomes true after the last page was empty", async () => {
        const r = await forEachPage(table(range(2)).fetch, () => undefined, { pageSize: 5, shouldStop: () => false })
        expect(r.stopped).toBe(false)
    })
    it("throws on a cursor that does not advance", async () => {
        const stuck = (after: number): Page<number> => ({ rows: [1], next: after })
        await expect(forEachPage(stuck, () => undefined)).rejects.toThrow(/did not advance/)
        const backwards = (): Page<number> => ({ rows: [1], next: -1 })
        await expect(forEachPage(backwards, () => undefined, { start: 5 })).rejects.toThrow(/did not advance \(5 -> -1\)/)
    })
    it.each([0, -1, 1.5, NaN])("rejects pageSize %p", async (pageSize) => {
        await expect(forEachPage(table([1]).fetch, () => undefined, { pageSize })).rejects.toThrow(/invalid page size/)
    })
    it("propagates a visit error", async () => {
        await expect(forEachPage(table(range(3)).fetch, () => { throw new Error("boom") })).rejects.toThrow("boom")
    })
})
