// compareImg/duplicateMath.ts - pure pieces of the bucketed duplicate finder.
import {
    clustersOf, ComparableRow, compareBucket, compareBucketExactOnly, makeDisjointSet,
    meanAbsDiff, MEAN_DIFF_THRESHOLD, mergeGroups, STOP_POLL_ROWS,
} from "../../compareImg/duplicateMath"

const grey = (...v: number[]) => Uint8Array.from(v)
const row = (mediaId: string, baseGrey: Uint8Array, contentMd5: string | null = null, baseMd5: string | null = null): ComparableRow =>
    ({ mediaId, baseGrey, contentMd5, baseMd5 })

// Runs a comparer and returns the clusters (sorted) it produced.
const groupsBy = (cmp: typeof compareBucket, bucket: ComparableRow[]): string[][] => {
    const ds = makeDisjointSet()
    const matched = new Set<string>()
    cmp(bucket, (a, b) => { matched.add(a); matched.add(b); ds.union(a, b) })
    return clustersOf(matched, ds.find).map(g => [...g].sort()).sort((x, y) => x[0].localeCompare(y[0]))
}
const pairs = (cmp: typeof compareBucket, bucket: ComparableRow[]): string[] => {
    const out: string[] = []
    cmp(bucket, (a, b) => out.push([a, b].sort().join("+")))
    return out.sort()
}

describe("makeDisjointSet", () => {
    it("singletons are their own root", () => {
        const ds = makeDisjointSet()
        expect(ds.find("a")).toBe("a")
        expect(ds.find("b")).not.toBe(ds.find("a"))
    })
    it("union is transitive and idempotent", () => {
        const ds = makeDisjointSet()
        ds.union("a", "b"); ds.union("c", "d"); ds.union("b", "c"); ds.union("a", "d")
        expect(new Set(["a", "b", "c", "d"].map(ds.find)).size).toBe(1)
        expect(ds.find("e")).toBe("e")
    })
    it("survives a long chain (path compression, no recursion)", () => {
        const ds = makeDisjointSet()
        for (let i = 0; i < 100_000; i++) ds.union(`n${i}`, `n${i + 1}`)
        expect(ds.find("n0")).toBe(ds.find("n100000"))
    })
})

describe("meanAbsDiff", () => {
    it("is 0 for identical buffers and averages absolute differences", () => {
        expect(meanAbsDiff(grey(1, 2, 3), grey(1, 2, 3))).toBe(0)
        expect(meanAbsDiff(grey(0, 10, 255, 5), grey(10, 0, 250, 5))).toBe((10 + 10 + 5 + 0) / 4)
    })
    it("is symmetric", () => {
        expect(meanAbsDiff(grey(9, 0), grey(0, 3))).toBe(meanAbsDiff(grey(0, 3), grey(9, 0)))
    })
    it("is Infinity for different lengths", () => {
        expect(meanAbsDiff(grey(1, 2), grey(1, 2, 3))).toBe(Infinity)
    })
})

describe("mergeGroups", () => {
    it("merges overlapping groups transitively and drops singletons", () => {
        const out = mergeGroups([["a", "b"], ["c", "d"], ["b", "c"], ["x"], ["y", "z"], []])
        const norm = out.map(g => [...g].sort()).sort((p, q) => p[0].localeCompare(q[0]))
        expect(norm).toEqual([["a", "b", "c", "d"], ["y", "z"]])
    })
    it("deduplicates ids repeated across groups", () => {
        expect(mergeGroups([["a", "b"], ["a", "b"], ["b", "a"]]).map(g => g.sort())).toEqual([["a", "b"]])
    })
    it("returns [] for no input", () => expect(mergeGroups([])).toEqual([]))
})

describe("compareBucket", () => {
    const far = grey(0, 0, 0, 0)
    const farther = grey(200, 200, 200, 200)

    it("never pairs two frames of the same media", () => {
        expect(pairs(compareBucket, [row("m", far, "c1", "b1"), row("m", far, "c1", "b1")])).toEqual([])
    })
    it("matches on equal contentMd5 even when pixels differ", () => {
        expect(pairs(compareBucket, [row("a", far, "same"), row("b", farther, "same")])).toEqual(["a+b"])
    })
    it("matches on equal baseMd5 even when pixels differ", () => {
        expect(pairs(compareBucket, [row("a", far, "c1", "bm"), row("b", farther, "c2", "bm")])).toEqual(["a+b"])
    })
    it("null md5s never match each other by md5", () => {
        expect(pairs(compareBucket, [row("a", far, null, null), row("b", farther, null, null)])).toEqual([])
    })
    it("matches by pixel distance at exactly the threshold, not above", () => {
        expect(MEAN_DIFF_THRESHOLD).toBe(3)
        expect(pairs(compareBucket, [row("a", grey(10, 10)), row("b", grey(13, 13))])).toEqual(["a+b"]) // diff = 3
        expect(pairs(compareBucket, [row("a", grey(10, 10)), row("b", grey(13, 14))])).toEqual([]) // diff = 3.5
        expect(pairs(compareBucket, [row("a", grey(10, 10, 10, 10)), row("b", grey(13, 13, 13, 14))])).toEqual([]) // 3.25
    })
    it("different-length buffers never match by pixels (but still by md5)", () => {
        expect(pairs(compareBucket, [row("a", grey(1, 1)), row("b", grey(1, 1, 1))])).toEqual([])
        expect(pairs(compareBucket, [row("a", grey(1, 1), "c"), row("b", grey(1, 1, 1), "c")])).toEqual(["a+b"])
    })
    it("empty buffers do not match (NaN distance)", () => {
        expect(pairs(compareBucket, [row("a", grey()), row("b", grey())])).toEqual([])
    })
    it("compares all pairs and fires onRow once per row", () => {
        const onRow = jest.fn()
        const out: string[] = []
        compareBucket([row("a", grey(5)), row("b", grey(6)), row("c", grey(100)), row("d", grey(101))], (x, y) => out.push(x + y), onRow)
        expect(out.sort()).toEqual(["ab", "cd"])
        expect(onRow).toHaveBeenCalledTimes(4)
    })
    it("multi-frame media: a match on any frame clusters the media", () => {
        const bucket = [row("v1", grey(0, 0)), row("v1", grey(100, 100)), row("v2", grey(101, 100)), row("img", grey(1, 1))]
        expect(groupsBy(compareBucket, bucket)).toEqual([["img", "v1", "v2"]])
    })
    it("empty and single-row buckets produce nothing", () => {
        const onRow = jest.fn()
        compareBucket([], () => { throw new Error("no") }, onRow)
        compareBucket([row("a", grey(1))], () => { throw new Error("no") }, onRow)
        expect(onRow).toHaveBeenCalledTimes(1)
    })
})

describe("compareBucketExactOnly", () => {
    const g = grey(1, 2, 3)
    it("matches equal contentMd5 and equal baseMd5 across different media only", () => {
        const bucket = [
            row("a", g, "c1", "b1"), row("a", g, "c1", "b9"), // same media twice: no self-match
            row("b", g, "c1", null),
            row("c", g, "c2", "b1"),
            row("d", g, null, null), row("e", g, null, null), // no keys: never matched
        ]
        expect(groupsBy(compareBucketExactOnly, bucket)).toEqual([["a", "b", "c"]])
    })
    it("never matches by pixel distance", () => {
        expect(pairs(compareBucketExactOnly, [row("a", grey(10, 10)), row("b", grey(10, 10))])).toEqual([])
    })
    it("a key seen first on a media's second frame still links later media", () => {
        expect(groupsBy(compareBucketExactOnly, [row("a", g, "x"), row("a", g, "k"), row("b", g, "k")])).toEqual([["a", "b"]])
    })
    it("fires onRow once per row", () => {
        const onRow = jest.fn()
        compareBucketExactOnly([row("a", g), row("b", g), row("c", g)], () => undefined, onRow)
        expect(onRow).toHaveBeenCalledTimes(3)
    })
    it("on exact-duplicate fixtures gives the same clusters as compareBucket", () => {
        // Distinct pixels per family so compareBucket's pixel rule does not add extra links.
        const fam = (n: number) => grey(n * 40, n * 40, n * 40)
        const bucket: ComparableRow[] = []
        for (let f = 0; f < 5; f++) {
            for (let k = 0; k < 3; k++) bucket.push(row(`f${f}m${k}`, fam(f), `content${f}`, k === 2 ? `base${f}` : null))
        }
        bucket.push(row("lone", grey(250, 250, 250), "contentLone", "baseLone"))
        bucket.push(row("viaBase", fam(4), "otherContent", "base4"))
        const exact = groupsBy(compareBucketExactOnly, bucket)
        expect(exact).toEqual(groupsBy(compareBucket, bucket))
        expect(exact).toHaveLength(5)
        expect(exact.find(c => c.includes("viaBase"))).toEqual(["f4m0", "f4m1", "f4m2", "viaBase"])
    })
    it("is a subset of compareBucket's clusters when near-duplicates exist", () => {
        const bucket = [row("a", grey(10, 10), "c"), row("b", grey(10, 10), "c"), row("near", grey(11, 11))]
        expect(groupsBy(compareBucketExactOnly, bucket)).toEqual([["a", "b"]])
        expect(groupsBy(compareBucket, bucket)).toEqual([["a", "b", "near"]])
    })
})

describe("clustersOf", () => {
    it("groups matched ids by root and drops singletons", () => {
        const ds = makeDisjointSet()
        ds.union("a", "b"); ds.union("c", "d")
        const out = clustersOf(["a", "b", "c", "d", "e"], ds.find).map(x => x.sort()).sort()
        expect(out).toEqual([["a", "b"], ["c", "d"]])
    })
    it("accepts any iterable", () => {
        const ds = makeDisjointSet()
        ds.union("x", "y")
        expect(clustersOf(new Set(["x", "y"]), ds.find).map(x => x.sort())).toEqual([["x", "y"]])
    })
})

describe("compareBucket stop polling", () => {
    // n rows of distinct media, all identical pixels: every pair matches.
    const same = (n: number) => Array.from({ length: n }, (_, i) => row(`m${i}`, grey(7, 7)))

    it("polls every STOP_POLL_ROWS rows (256)", () => {
        expect(STOP_POLL_ROWS).toBe(256)
        const shouldStop = jest.fn(() => false)
        expect(compareBucket(same(1000), () => undefined, undefined, shouldStop)).toBe(true)
        // at rows 256, 512, 768 (never at row 0)
        expect(shouldStop).toHaveBeenCalledTimes(3)
    })
    it("returns true and never polls for a bucket of at most 256 rows", () => {
        const shouldStop = jest.fn(() => true)
        expect(compareBucket(same(256), () => undefined, undefined, shouldStop)).toBe(true)
        expect(shouldStop).not.toHaveBeenCalled()
    })
    it("returns false when stopped, after finishing exactly STOP_POLL_ROWS rows", () => {
        const onRow = jest.fn()
        let matches = 0
        expect(compareBucket(same(600), () => { matches++ }, onRow, () => true)).toBe(false)
        expect(onRow).toHaveBeenCalledTimes(STOP_POLL_ROWS)
        // rows 0..255 each compared against every later row
        let expected = 0
        for (let i = 0; i < STOP_POLL_ROWS; i++) expected += 600 - 1 - i
        expect(matches).toBe(expected)
    })
    it("a stop raised mid-way is seen at the next poll", () => {
        let rows = 0
        const r = compareBucket(same(1000), () => undefined, () => { rows++ }, () => rows >= 300)
        expect(r).toBe(false)
        expect(rows).toBe(512)
    })
    it("without shouldStop it completes and returns true", () => {
        expect(compareBucket(same(300), () => undefined)).toBe(true)
    })
})

describe("compareBucketExactOnly on key-only rows", () => {
    it("works on rows without baseGrey (capped buckets load only the md5 keys)", () => {
        const keyRows = [
            { mediaId: "a", contentMd5: "c", baseMd5: null },
            { mediaId: "b", contentMd5: "c", baseMd5: null },
            { mediaId: "x", contentMd5: null, baseMd5: "k" },
            { mediaId: "y", contentMd5: "z", baseMd5: "k" },
        ]
        const out: string[] = []
        compareBucketExactOnly(keyRows, (p, q) => out.push([p, q].sort().join("+")))
        expect(out.sort()).toEqual(["a+b", "x+y"])
    })
})
