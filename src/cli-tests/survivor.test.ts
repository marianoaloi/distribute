// Pure survivor rule shared by the LSR report (reporting/survivor.ts).
import { pickSurvivor, survivorCandidates, SurvivorCandidate } from "../../reporting/survivor"

const m = (id: string, mime: string, size: number, hasAudio = false): SurvivorCandidate => ({ id, mime, size, hasAudio })

describe("survivorCandidates", () => {
    it("prefers videos with audio over everything else", () => {
        const g = [m("a", "image/jpeg", 900), m("b", "video/mp4", 10, true), m("c", "video/mp4", 50), m("d", "image/gif", 80)]
        expect(survivorCandidates(g).map(x => x.id)).toEqual(["b"])
    })
    it("falls back to any video when none has audio", () => {
        const g = [m("a", "image/jpeg", 900), m("c", "video/mp4", 50), m("e", "video/webm", 40), m("d", "image/gif", 80)]
        expect(survivorCandidates(g).map(x => x.id)).toEqual(["c", "e"])
    })
    it("falls back to gifs when there are no videos", () => {
        const g = [m("a", "image/jpeg", 900), m("d", "image/gif", 80)]
        expect(survivorCandidates(g).map(x => x.id)).toEqual(["d"])
    })
    it("falls back to every member otherwise", () => {
        const g = [m("a", "image/jpeg", 900), m("b", "image/png", 80)]
        expect(survivorCandidates(g).map(x => x.id)).toEqual(["a", "b"])
    })
    it("returns a copy, not the input array", () => {
        const g = [m("a", "image/png", 1)]
        expect(survivorCandidates(g)).not.toBe(g)
    })
    it("treats a mime containing both video and gif as a video", () => {
        const g = [m("x", "video/gif", 5), m("y", "image/gif", 500)]
        expect(survivorCandidates(g).map(x => x.id)).toEqual(["x"])
    })
})

describe("pickSurvivor", () => {
    it("returns undefined for an empty group", () => {
        expect(pickSurvivor([])).toBeUndefined()
    })
    it("picks the biggest file among the candidates, not overall", () => {
        const g = [m("big", "image/jpeg", 10_000), m("v1", "video/mp4", 10), m("v2", "video/mp4", 20)]
        expect(pickSurvivor(g)?.id).toBe("v2")
    })
    it("picks the biggest sounded video even if a silent one is bigger", () => {
        const g = [m("silent", "video/mp4", 999), m("s1", "video/mp4", 5, true), m("s2", "video/mp4", 7, true)]
        expect(pickSurvivor(g)?.id).toBe("s2")
    })
    it("on equal size picks the lexicographically smallest id, independent of order", () => {
        const a = [m("zz", "image/png", 100), m("aa", "image/png", 100), m("mm", "image/png", 100)]
        expect(pickSurvivor(a)?.id).toBe("aa")
        expect(pickSurvivor([...a].reverse())?.id).toBe("aa")
    })
    it("size beats id ordering", () => {
        expect(pickSurvivor([m("a", "image/png", 1), m("b", "image/png", 2)])?.id).toBe("b")
    })
    it("single-member group returns that member", () => {
        const only = m("only", "image/png", 3)
        expect(pickSurvivor([only])).toBe(only)
    })
})
