/**
 * @jest-environment node
 */
// Pure path rules of DirectorioCache.ts: how media paths are stored in
// index.db (relative to the opened folder) and where a move puts a file.
import os from "os"
import path from "path"
import { fromStoredPath, moveTargetFor, relativeInside, setActiveFolder, toStoredPath } from "../../DirectorioCache"

const root = path.join(os.tmpdir(), "photos")
const inRoot = (...parts: string[]) => path.join(root, ...parts)

describe("toStoredPath / fromStoredPath", () => {
    beforeEach(() => setActiveFolder(root))

    it("stores a path inside the opened folder relative to it, with / separators", () => {
        expect(toStoredPath(inRoot("family", "2006", "a.jpg"))).toBe("family/2006/a.jpg")
        expect(toStoredPath(inRoot("a.jpg"))).toBe("a.jpg")
    })
    it("keeps a path outside the opened folder absolute", () => {
        const outside = path.join(os.tmpdir(), "elsewhere", "a.jpg")
        expect(toStoredPath(outside)).toBe(outside)
        // A sibling whose name merely starts with the root's name is outside too.
        expect(toStoredPath(path.join(os.tmpdir(), "photos-old", "a.jpg"))).toBe(path.join(os.tmpdir(), "photos-old", "a.jpg"))
    })
    it("keeps a file whose name starts with '..' inside the folder relative", () => {
        expect(toStoredPath(inRoot("..hidden.jpg"))).toBe("..hidden.jpg")
    })
    it("treats an already relative path as stored", () => {
        expect(toStoredPath("family/2006/a.jpg")).toBe("family/2006/a.jpg")
    })
    it("round-trips back to the absolute path", () => {
        const file = inRoot("family", "2006", "a.jpg")
        expect(fromStoredPath(toStoredPath(file))).toBe(file)
        const outside = path.join(os.tmpdir(), "elsewhere", "a.jpg")
        expect(fromStoredPath(toStoredPath(outside))).toBe(outside)
    })
    it("resolves stored paths against whatever folder is opened now", () => {
        const moved = path.join(os.tmpdir(), "moved", "photos")
        setActiveFolder(moved)
        expect(fromStoredPath("family/2006/a.jpg")).toBe(path.join(moved, "family", "2006", "a.jpg"))
    })
    it("takes an explicit root", () => {
        const other = path.join(os.tmpdir(), "other")
        expect(toStoredPath(path.join(other, "x", "b.png"), other)).toBe("x/b.png")
        expect(fromStoredPath("x/b.png", other)).toBe(path.join(other, "x", "b.png"))
    })
})

describe("relativeInside", () => {
    it("is null for the root itself and for anything outside it", () => {
        expect(relativeInside(root, root)).toBeNull()
        expect(relativeInside(root, os.tmpdir())).toBeNull()
        expect(relativeInside(root, path.join(os.tmpdir(), "photos-old"))).toBeNull()
    })
    it("is the path below the root otherwise", () => {
        expect(relativeInside(root, inRoot("family", "2006"))).toBe(path.join("family", "2006"))
    })
})

describe("moveTargetFor", () => {
    it("keeps the file's subfolder below the opened folder", () => {
        expect(moveTargetFor(root, "L", inRoot("family", "2006", "a.jpg"))).toBe(inRoot("tmp", "L", "family", "2006", "a.jpg"))
    })
    it("keeps same-named files from different subfolders apart", () => {
        const a = moveTargetFor(root, "L", inRoot("family", "2006", "a.jpg"))
        const b = moveTargetFor(root, "L", inRoot("family", "2007", "a.jpg"))
        expect(a).not.toBe(b)
    })
    it("puts a file directly in the opened folder straight into tmp/<dest>", () => {
        expect(moveTargetFor(root, "R", inRoot("a.jpg"))).toBe(inRoot("tmp", "R", "a.jpg"))
    })
    it("puts a file from outside the opened folder straight into tmp/<dest>", () => {
        expect(moveTargetFor(root, "L", path.join(os.tmpdir(), "elsewhere", "a.jpg"))).toBe(inRoot("tmp", "L", "a.jpg"))
    })
})
