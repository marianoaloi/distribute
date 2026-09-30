// The component module imports the redux store, whose RTK Query dependency
// ships ESM that CRA's jest won't transform. Only the pure helpers are under
// test here, so the store modules are stubbed out.
jest.mock("../lib/redux", () => ({}))
jest.mock("../lib/redux/slices/configurations", () => ({}))

import { matchesClassFilter, normalizeClassFilter } from "./classFilter"
import { ClassFilterTerm } from "../entity/FilterMedia"
import { MediaDetections } from "../lib/redux/slices/detections/detections.reduce"

const media = (classScores: Record<string, { min: number; max: number }>): MediaDetections => ({
    boxes: [],
    classes: Object.keys(classScores),
    classScores,
})

const term = (className: string, score?: number | null, negate = false): ClassFilterTerm =>
    score === undefined ? { className, negate } : { className, negate, score }

const one = (t: ClassFilterTerm) => [[t]]

describe("matchesClassFilter - positive score threshold", () => {
    it("90 passes when max score is exactly 0.90", () => {
        expect(matchesClassFilter(media({ cat: { min: 0.3, max: 0.9 } }), one(term("cat", 90)))).toBe(true)
    })

    it("90 fails when max score is 0.89", () => {
        expect(matchesClassFilter(media({ cat: { min: 0.3, max: 0.89 } }), one(term("cat", 90)))).toBe(false)
    })

    it("90 uses max, not min", () => {
        expect(matchesClassFilter(media({ cat: { min: 0.1, max: 0.95 } }), one(term("cat", 90)))).toBe(true)
    })

    it("0 is always true when the class is present", () => {
        expect(matchesClassFilter(media({ cat: { min: 0, max: 0 } }), one(term("cat", 0)))).toBe(true)
        expect(matchesClassFilter(media({ cat: { min: 0.01, max: 0.02 } }), one(term("cat", 0)))).toBe(true)
    })

    it("0 fails when the class is absent", () => {
        expect(matchesClassFilter(media({ dog: { min: 0.9, max: 0.9 } }), one(term("cat", 0)))).toBe(false)
    })

    it("100 needs a detection of 1.0", () => {
        expect(matchesClassFilter(media({ cat: { min: 1, max: 1 } }), one(term("cat", 100)))).toBe(true)
        expect(matchesClassFilter(media({ cat: { min: 0.5, max: 0.99 } }), one(term("cat", 100)))).toBe(false)
    })
})

describe("matchesClassFilter - negative score threshold", () => {
    it("-50 passes when min score is exactly 0.50", () => {
        expect(matchesClassFilter(media({ cat: { min: 0.5, max: 0.9 } }), one(term("cat", -50)))).toBe(true)
    })

    it("-50 fails when min score is 0.51", () => {
        expect(matchesClassFilter(media({ cat: { min: 0.51, max: 0.9 } }), one(term("cat", -50)))).toBe(false)
    })

    it("-50 fails for media lacking the class", () => {
        expect(matchesClassFilter(media({ dog: { min: 0.1, max: 0.2 } }), one(term("cat", -50)))).toBe(false)
        expect(matchesClassFilter(undefined, one(term("cat", -50)))).toBe(false)
        expect(matchesClassFilter(media({}), one(term("cat", -100)))).toBe(false)
    })
})

describe("matchesClassFilter - presence only", () => {
    it("null score means presence only", () => {
        expect(matchesClassFilter(media({ cat: { min: 0.01, max: 0.01 } }), one(term("cat", null)))).toBe(true)
        expect(matchesClassFilter(media({ dog: { min: 0.9, max: 0.9 } }), one(term("cat", null)))).toBe(false)
    })

    it("old terms without a score field mean presence only", () => {
        const legacy = { className: "cat", negate: false } as ClassFilterTerm
        expect("score" in legacy).toBe(false)
        expect(matchesClassFilter(media({ cat: { min: 0.01, max: 0.01 } }), [[legacy]])).toBe(true)
        expect(matchesClassFilter(media({}), [[legacy]])).toBe(false)
    })

    it("present class without a classScores entry passes presence but fails a score term", () => {
        const noScores: MediaDetections = { boxes: [], classes: ["cat"], classScores: {} }
        expect(matchesClassFilter(noScores, one(term("cat")))).toBe(true)
        expect(matchesClassFilter(noScores, one(term("cat", 50)))).toBe(false)
    })

    it("undefined detection fails positive terms and satisfies negated ones", () => {
        expect(matchesClassFilter(undefined, one(term("cat")))).toBe(false)
        expect(matchesClassFilter(undefined, one(term("cat", null, true)))).toBe(true)
    })

    it("empty groups match everything", () => {
        expect(matchesClassFilter(undefined, [])).toBe(true)
    })
})

describe("matchesClassFilter - negate", () => {
    it("NOT cat 90 inverts the whole term", () => {
        expect(matchesClassFilter(media({ cat: { min: 0.3, max: 0.9 } }), one(term("cat", 90, true)))).toBe(false)
        expect(matchesClassFilter(media({ cat: { min: 0.3, max: 0.89 } }), one(term("cat", 90, true)))).toBe(true)
    })

    it("NOT cat -50 matches media lacking the class", () => {
        expect(matchesClassFilter(media({ dog: { min: 0.1, max: 0.1 } }), one(term("cat", -50, true)))).toBe(true)
        expect(matchesClassFilter(media({ cat: { min: 0.5, max: 0.5 } }), one(term("cat", -50, true)))).toBe(false)
        expect(matchesClassFilter(media({ cat: { min: 0.51, max: 0.9 } }), one(term("cat", -50, true)))).toBe(true)
    })

    it("NOT cat without score excludes any cat", () => {
        expect(matchesClassFilter(media({ cat: { min: 0.01, max: 0.01 } }), one(term("cat", null, true)))).toBe(false)
    })
})

describe("matchesClassFilter - groups", () => {
    const m = media({ cat: { min: 0.4, max: 0.95 }, dog: { min: 0.2, max: 0.6 } })

    it("AND requires every term in a group", () => {
        expect(matchesClassFilter(m, [[term("cat", 90), term("dog", 50)]])).toBe(true)
        expect(matchesClassFilter(m, [[term("cat", 90), term("dog", 70)]])).toBe(false)
        expect(matchesClassFilter(m, [[term("cat", 90), term("bird", null, true)]])).toBe(true)
    })

    it("OR requires any group", () => {
        expect(matchesClassFilter(m, [[term("dog", 70)], [term("cat", -40)]])).toBe(true)
        expect(matchesClassFilter(m, [[term("dog", 70)], [term("cat", -30)]])).toBe(false)
    })

    it("mixes OR of AND", () => {
        const groups = [
            [term("bird"), term("cat")],
            [term("dog", -20), term("cat", 96, true)],
        ]
        expect(matchesClassFilter(m, groups)).toBe(true)
        expect(matchesClassFilter(media({ cat: { min: 0.4, max: 0.97 }, dog: { min: 0.2, max: 0.6 } }), groups)).toBe(false)
    })
})

describe("normalizeClassFilter", () => {
    it("drops terms with no class and groups left empty", () => {
        const result = normalizeClassFilter([
            [term(""), term("cat", 90)],
            [term("", 50)],
            [],
            [term("dog", -50, true)],
        ])
        expect(result).toEqual([[term("cat", 90)], [term("dog", -50, true)]])
    })

    it("keeps score values untouched", () => {
        expect(normalizeClassFilter([[term("cat", null), term("dog")]])).toEqual([[term("cat", null), term("dog")]])
    })

    it("returns empty for an all-empty filter", () => {
        expect(normalizeClassFilter([[term("")], []])).toEqual([])
    })
})
