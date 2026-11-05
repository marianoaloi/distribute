// The component module imports the redux store, whose RTK Query dependency
// ships ESM that CRA's jest won't transform. Only the pure helpers are under
// test here, so the store modules are stubbed out.
jest.mock("../lib/redux", () => ({}))
jest.mock("../lib/redux/slices/configurations", () => ({}))

import {
    evalClassExpr, groupResolver, hasClass, isStaleGroup, matchesClassFilter, matchesClassPresence, normalizeClassFilter
} from "./classFilter"
import { ClassExpr, ClassFilterTerm } from "../entity/FilterMedia"
import { DetectionGroup, MediaDetections } from "../lib/redux/slices/detections/detections.reduce"

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

describe("hasClass / matchesClassPresence", () => {
    it("hasClass is false for media never detected or detected with nothing found", () => {
        expect(hasClass(undefined)).toBe(false)
        expect(hasClass(media({}))).toBe(false)
        expect(hasClass(media({ cat: { min: 0.5, max: 0.5 } }))).toBe(true)
    })

    it("empty presence keeps everything", () => {
        expect(matchesClassPresence(true, '')).toBe(true)
        expect(matchesClassPresence(false, '')).toBe(true)
    })

    it("'with' keeps only media with a class, 'without' only media with none", () => {
        expect(matchesClassPresence(true, 'with')).toBe(true)
        expect(matchesClassPresence(false, 'with')).toBe(false)
        expect(matchesClassPresence(true, 'without')).toBe(false)
        expect(matchesClassPresence(false, 'without')).toBe(true)
    })
})

// ---- .maloi group expressions --------------------------------------------

const c = (id: number): ClassExpr => ({ op: "class", id })
const not = (arg: ClassExpr): ClassExpr => ({ op: "not", arg })
const and = (...args: ClassExpr[]): ClassExpr => ({ op: "and", args })
const or = (...args: ClassExpr[]): ClassExpr => ({ op: "or", args })

const has = (...ids: number[]) => (id: number) => ids.includes(id)

describe("evalClassExpr", () => {
    it("class is presence of that id", () => {
        expect(evalClassExpr(c(2), has(2))).toBe(true)
        expect(evalClassExpr(c(2), has(1, 3))).toBe(false)
        expect(evalClassExpr(c(0), has(0))).toBe(true)
    })

    it("not inverts", () => {
        expect(evalClassExpr(not(c(2)), has(2))).toBe(false)
        expect(evalClassExpr(not(c(2)), has())).toBe(true)
        expect(evalClassExpr(not(not(c(2))), has(2))).toBe(true)
    })

    it("and needs every arg, or needs any", () => {
        expect(evalClassExpr(and(c(1), c(2), c(3)), has(1, 2, 3))).toBe(true)
        expect(evalClassExpr(and(c(1), c(2), c(3)), has(1, 3))).toBe(false)
        expect(evalClassExpr(or(c(1), c(2), c(3)), has(3))).toBe(true)
        expect(evalClassExpr(or(c(1), c(2), c(3)), has(4))).toBe(false)
    })

    it("evaluates the user's example (6 || 7 || 8 || 9) && !(1 || 2 || 3)", () => {
        const expr = and(or(c(6), c(7), c(8), c(9)), not(or(c(1), c(2), c(3))))
        expect(evalClassExpr(expr, has(6))).toBe(true)
        expect(evalClassExpr(expr, has(9, 4))).toBe(true)
        expect(evalClassExpr(expr, has(7, 2))).toBe(false)
        expect(evalClassExpr(expr, has(4))).toBe(false)
        expect(evalClassExpr(expr, has())).toBe(false)
    })
})

// ids 0..3
const classNames = ["person", "car", "dog", "cat"]

const grp = (name: string, ast: ClassExpr, expr = ""): DetectionGroup => ({ name, expr, ast })

const groups: DetectionGroup[] = [
    grp("pets", or(c(2), c(3))),
    grp("vehicles", c(1)),
    grp("noVehicle", not(c(1))),
    grp("personWithPet", and(c(0), or(c(2), c(3)))),
    // 7 >= classNames.length: the class list changed since the .maloi was read
    grp("stale", or(c(1), c(7))),
]

const gterm = (group: string, negate = false, score: number | null = null): ClassFilterTerm =>
    ({ className: "", group, negate, score })

const at = (score: number) => ({ min: score, max: score })

describe("isStaleGroup", () => {
    it("is false while every id fits the class list", () => {
        expect(isStaleGroup(grp("g", c(3)), classNames)).toBe(false)
        expect(isStaleGroup(grp("g", and(c(0), not(or(c(1), c(3))))), classNames)).toBe(false)
    })

    it("is true when any id, however deep, reaches the class count", () => {
        expect(isStaleGroup(grp("g", c(4)), classNames)).toBe(true)
        expect(isStaleGroup(grp("g", and(c(0), not(or(c(1), c(9))))), classNames)).toBe(true)
        expect(isStaleGroup(grp("g", not(c(4))), classNames)).toBe(true)
    })

    it("every group is stale with no class names", () => {
        expect(isStaleGroup(grp("g", c(0)), [])).toBe(true)
    })
})

describe("groupResolver", () => {
    const resolve = groupResolver(groups, classNames)

    it("is undefined for unknown and stale groups", () => {
        expect(resolve("nope")).toBeUndefined()
        expect(resolve("")).toBeUndefined()
        expect(resolve("stale")).toBeUndefined()
    })

    it("resolves ids to class names and matches the media's class names", () => {
        const pets = resolve("pets")!
        expect(pets).toBeInstanceOf(Function)
        expect(pets(["dog"])).toBe(true)
        expect(pets(["person", "cat"])).toBe(true)
        expect(pets(["person", "car"])).toBe(false)
        expect(pets([])).toBe(false)
        expect(resolve("personWithPet")!(["cat", "person"])).toBe(true)
        expect(resolve("personWithPet")!(["cat"])).toBe(false)
    })

    it("uses the given class list order (ids are indexes into it)", () => {
        const reordered = groupResolver(groups, ["dog", "cat", "person", "car"])
        expect(reordered("pets")!(["person"])).toBe(true)
        expect(reordered("pets")!(["dog"])).toBe(false)
    })

    it("ignores media classes outside the class list", () => {
        expect(resolve("noVehicle")!(["zebra"])).toBe(true)
        expect(resolve("pets")!(["zebra"])).toBe(false)
    })

    it("resolves nothing with no groups", () => {
        expect(groupResolver([], classNames)("pets")).toBeUndefined()
    })
})

describe("matchesClassFilter - group terms", () => {
    const resolve = groupResolver(groups, classNames)
    const match = (d: MediaDetections | undefined, f: ClassFilterTerm[][]) => matchesClassFilter(d, f, resolve)

    it("holds when the group expression is true over the media's classes", () => {
        expect(match(media({ dog: at(0.5) }), one(gterm("pets")))).toBe(true)
        expect(match(media({ person: at(0.5), cat: at(0.5) }), one(gterm("personWithPet")))).toBe(true)
        expect(match(media({ person: at(0.5) }), one(gterm("pets")))).toBe(false)
        expect(match(media({ person: at(0.5) }), one(gterm("personWithPet")))).toBe(false)
    })

    it("NOT inverts the whole expression", () => {
        expect(match(media({ dog: at(0.5) }), one(gterm("pets", true)))).toBe(false)
        expect(match(media({ person: at(0.5) }), one(gterm("pets", true)))).toBe(true)
        expect(match(media({ car: at(0.5) }), one(gterm("noVehicle", true)))).toBe(true)
        expect(match(media({ dog: at(0.5) }), one(gterm("noVehicle", true)))).toBe(false)
    })

    it("ANDs with a class term in the same group", () => {
        const filter = [[gterm("pets"), term("person", 90)]]
        expect(match(media({ person: at(0.95), dog: at(0.3) }), filter)).toBe(true)
        expect(match(media({ person: at(0.5), dog: at(0.3) }), filter)).toBe(false)
        expect(match(media({ person: at(0.95) }), filter)).toBe(false)
        expect(match(media({ person: at(0.95), car: at(0.9) }), [[gterm("pets", true), term("person", 90)]])).toBe(true)
    })

    it("ORs across groups", () => {
        const filter = [[gterm("pets")], [gterm("vehicles")]]
        expect(match(media({ dog: at(0.5) }), filter)).toBe(true)
        expect(match(media({ car: at(0.5) }), filter)).toBe(true)
        expect(match(media({ person: at(0.5) }), filter)).toBe(false)
        expect(match(media({ person: at(0.5) }), [[gterm("pets")], [term("person")]])).toBe(true)
    })

    it("a media without detections evaluates against an empty class set", () => {
        for (const none of [undefined, media({})]) {
            expect(match(none, one(gterm("noVehicle")))).toBe(true)
            expect(match(none, one(gterm("pets")))).toBe(false)
            expect(match(none, one(gterm("pets", true)))).toBe(true)
            expect(match(none, one(gterm("noVehicle", true)))).toBe(false)
        }
    })

    it("ignores a score set on a group term", () => {
        expect(match(media({ dog: at(0.1) }), one(gterm("pets", false, 90)))).toBe(true)
        expect(match(media({ dog: at(0.9) }), one(gterm("pets", false, -50)))).toBe(true)
        expect(match(media({ person: at(0.99) }), one(gterm("pets", false, 0)))).toBe(false)
        expect(match(media({ dog: at(0.1) }), one(gterm("pets", true, 90)))).toBe(false)
        // no classScores entry at all: a group term still matches on presence
        expect(match({ boxes: [], classes: ["dog"], classScores: {} }, one(gterm("pets", false, 50)))).toBe(true)
    })

    it("an unresolvable group term never holds (normalize drops it before matching)", () => {
        expect(match(media({ dog: at(0.5) }), one(gterm("nope")))).toBe(false)
        expect(match(media({ car: at(0.5) }), one(gterm("stale")))).toBe(false)
        expect(matchesClassFilter(media({ dog: at(0.5) }), one(gterm("pets")))).toBe(false)
        expect(match(media({ dog: at(0.5) }), normalizeClassFilter(one(gterm("nope")), resolve))).toBe(true)
    })
})

describe("normalizeClassFilter - group terms", () => {
    const resolve = groupResolver(groups, classNames)

    it("with a resolver drops unknown and stale group terms, keeping resolvable ones", () => {
        const result = normalizeClassFilter([
            [gterm("pets"), gterm("nope")],
            [gterm("stale")],
            [gterm("noVehicle", true, 90), term("cat", 50)],
            [term(""), gterm("vehicles")],
        ], resolve)
        expect(result).toEqual([
            [gterm("pets")],
            [gterm("noVehicle", true, 90), term("cat", 50)],
            [gterm("vehicles")],
        ])
    })

    it("returns empty when every group term is unresolvable", () => {
        expect(normalizeClassFilter([[gterm("nope")], [gterm("stale", true)]], resolve)).toEqual([])
    })

    it("a group term is not a half-built row even though className is empty", () => {
        expect(normalizeClassFilter([[gterm("pets")]], resolve)).toEqual([[gterm("pets")]])
    })

    it("without a resolver keeps every group term", () => {
        expect(normalizeClassFilter([[gterm("pets"), gterm("nope")], [gterm("stale")], [term("")]]))
            .toEqual([[gterm("pets"), gterm("nope")], [gterm("stale")]])
    })

    it("an empty group name is a half-built row", () => {
        expect(normalizeClassFilter([[gterm(""), term("cat")]], resolve)).toEqual([[term("cat")]])
    })
})
