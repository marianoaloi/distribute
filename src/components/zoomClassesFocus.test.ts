// The module imports the redux store and classFilter (which imports it too),
// whose RTK Query dependency ships ESM that CRA's jest won't transform. Only
// the pure helpers are under test here, so those modules are stubbed out.
jest.mock("../lib/redux", () => ({}))
jest.mock("../lib/redux/slices/configurations", () => ({}))
jest.mock("./classFilter", () => ({}))
// The config reducer handles media's populateArray, and media.reduce pulls in
// RTK Query: stand in an action with the same type.
jest.mock("../lib/redux/slices/media/media.reduce", () => ({
    populateArray: jest.requireActual("@reduxjs/toolkit").createAction("medias/populateArray"),
}))

import { classesRegion, focusClassBoxes, focusStyles, nextZoomMode, Region } from "./zoomClassesFocus"
import { DetectionBox } from "../lib/redux/slices/detections/detections.reduce"
import { ConfigReduce } from "../lib/redux/slices/configurations/reducer"
import { setZoomToClasses, ZoomToClassesMode } from "../lib/redux/slices/configurations/thunks"

const box = (x: number, y: number, w: number, h: number, className = "cat"): DetectionBox =>
    ({ x, y, w, h, score: 0.9, classId: 0, className })

const expectRegion = (actual: Region | undefined, expected: Region) => {
    expect(actual).toBeDefined()
    expect(actual!.left).toBeCloseTo(expected.left, 10)
    expect(actual!.top).toBeCloseTo(expected.top, 10)
    expect(actual!.width).toBeCloseTo(expected.width, 10)
    expect(actual!.height).toBeCloseTo(expected.height, 10)
}

describe("classesRegion", () => {
    it("is undefined with no boxes", () => {
        expect(classesRegion([])).toBeUndefined()
    })

    it("keeps a 2% margin around a single box", () => {
        expectRegion(classesRegion([box(0.2, 0.3, 0.4, 0.2)]), { left: 0.18, top: 0.28, width: 0.44, height: 0.24 })
    })

    it("spans leftmost to rightmost and topmost to bottommost of all boxes", () => {
        const boxes = [box(0.1, 0.5, 0.1, 0.1), box(0.6, 0.2, 0.2, 0.1), box(0.3, 0.3, 0.1, 0.1)]
        // left 0.1, top 0.2, right 0.8, bottom 0.6 - each pushed out by 0.02
        expectRegion(classesRegion(boxes), { left: 0.08, top: 0.18, width: 0.74, height: 0.44 })
    })

    it("does not depend on box order", () => {
        const boxes = [box(0.1, 0.5, 0.1, 0.1), box(0.6, 0.2, 0.2, 0.1)]
        expect(classesRegion([...boxes].reverse())).toEqual(classesRegion(boxes))
    })

    it("clamps the margin to the picture (0-1)", () => {
        expectRegion(classesRegion([box(0, 0.01, 1, 0.99)]), { left: 0, top: 0, width: 1, height: 1 })
        expectRegion(classesRegion([box(0.99, 0.995, 0.01, 0.005)]), { left: 0.97, top: 0.975, width: 0.03, height: 0.025 })
        expectRegion(classesRegion([box(0.005, 0.01, 0.1, 0.1)]), { left: 0, top: 0, width: 0.125, height: 0.13 })
    })

    it("gives a zero-sized box the margin as its area", () => {
        expectRegion(classesRegion([box(0.5, 0.5, 0, 0)]), { left: 0.48, top: 0.48, width: 0.04, height: 0.04 })
    })

    it("is undefined when the boxes lie entirely outside the picture", () => {
        expect(classesRegion([box(1.5, 0.2, 0.1, 0.1)])).toBeUndefined()
        expect(classesRegion([box(0.2, -0.5, 0.1, 0.1)])).toBeUndefined()
    })
})

describe("nextZoomMode", () => {
    const cases: [ZoomToClassesMode, 'all' | 'focus', ZoomToClassesMode][] = [
        ['off', 'all', 'all'],
        ['off', 'focus', 'focus'],
        ['all', 'all', 'off'],
        ['all', 'focus', 'focus'],
        ['focus', 'focus', 'off'],
        ['focus', 'all', 'all'],
    ]
    it.each(cases)("%s + %s -> %s", (current, pressed, expected) => {
        expect(nextZoomMode(current, pressed)).toBe(expected)
    })
})

describe("focusClassBoxes", () => {
    const boxes = [
        box(0.1, 0.1, 0.1, 0.1, "cat"),
        box(0.2, 0.2, 0.1, 0.1, "Dog"),
        box(0.3, 0.3, 0.1, 0.1, "dog"),
        box(0.4, 0.4, 0.1, 0.1, "person"),
        box(0.5, 0.5, 0.1, 0.1, "dog"),
    ]

    it("keeps only the boxes of the focus classes, in order", () => {
        expect(focusClassBoxes(boxes, new Set(["dog", "person"]))).toEqual([boxes[2], boxes[3], boxes[4]])
    })

    it("matches names exactly and case-sensitively", () => {
        expect(focusClassBoxes(boxes, new Set(["Dog"]))).toEqual([boxes[1]])
        expect(focusClassBoxes(boxes, new Set(["DOG", "do", "dogs", " dog"]))).toEqual([])
    })

    it("is empty with no focus names or no boxes", () => {
        expect(focusClassBoxes(boxes, new Set())).toEqual([])
        expect(focusClassBoxes([], new Set(["dog"]))).toEqual([])
    })

    it("zooms to the focus boxes only", () => {
        // the cat (0.1) and the Dog (0.2) are left out: region starts at the dog
        const focus = focusClassBoxes(boxes, new Set(["dog"]))
        expectRegion(classesRegion(focus), { left: 0.28, top: 0.28, width: 0.34, height: 0.34 })
    })

    it("with no focus box falls back to no region (the whole picture)", () => {
        expect(classesRegion(focusClassBoxes(boxes, new Set(["bird"])))).toBeUndefined()
        expect(classesRegion(focusClassBoxes(boxes, new Set()))).toBeUndefined()
    })
})

describe("focusStyles", () => {
    const quarter: Region = { left: 0.25, top: 0.25, width: 0.5, height: 0.5 }

    it("fits the region to the view (height-limited) and centres it horizontally", () => {
        // region 500x400 px in a 1000x500 view: scale min(2, 1.25) = 1.25
        const styles = focusStyles(quarter, { w: 1000, h: 800 }, { w: 1000, h: 500 }, 1)!
        expect(styles.viewport).toEqual({ position: 'absolute', left: 187.5, top: 0, width: 625, height: 500, overflow: 'hidden' })
        expect(styles.wrapper).toEqual({ left: -312.5, top: -250, overflow: 'visible' })
        expect(styles.image).toEqual({ width: 1250, height: 1000, maxWidth: 'none', maxHeight: 'none', transform: 'none' })
    })

    it("fits the region to the view (width-limited) and centres it vertically", () => {
        // whole 400x200 picture in an 800x800 view: scale min(2, 4) = 2
        const styles = focusStyles({ left: 0, top: 0, width: 1, height: 1 }, { w: 400, h: 200 }, { w: 800, h: 800 }, 1)!
        expect(styles.viewport).toMatchObject({ left: 0, top: 200, width: 800, height: 400 })
        expect(styles.wrapper).toMatchObject({ left: -0, top: -0 })
        expect(styles.image).toMatchObject({ width: 800, height: 400 })
    })

    it("multiplies the fit scale by the zoom and anchors top-left once past the view", () => {
        const styles = focusStyles(quarter, { w: 1000, h: 800 }, { w: 1000, h: 500 }, 2)!
        // scale 1.25 * 2 = 2.5
        expect(styles.image).toMatchObject({ width: 2500, height: 2000 })
        expect(styles.viewport).toMatchObject({ left: 0, top: 0, width: 1250, height: 1000 })
        expect(styles.wrapper).toMatchObject({ left: -625, top: -500 })
    })

    it("zooming out below 1 shrinks and re-centres the region", () => {
        const styles = focusStyles(quarter, { w: 1000, h: 800 }, { w: 1000, h: 500 }, 0.5)!
        // scale 0.625: region 312.5 x 250, floored to whole pixels
        expect(styles.image).toMatchObject({ width: 625, height: 500 })
        expect(styles.viewport).toMatchObject({ width: 312, height: 250, left: 344, top: 125 })
    })

    it("floors the viewport to whole pixels", () => {
        const styles = focusStyles({ left: 0, top: 0, width: 1, height: 1 }, { w: 300, h: 200 }, { w: 1001, h: 1001 }, 1)!
        expect(Number.isInteger(styles.viewport.width)).toBe(true)
        expect(styles.viewport.height).toBe(667)
    })

    it("is undefined while any size is zero", () => {
        expect(focusStyles(quarter, { w: 0, h: 800 }, { w: 1000, h: 500 }, 1)).toBeUndefined()
        expect(focusStyles(quarter, { w: 1000, h: 0 }, { w: 1000, h: 500 }, 1)).toBeUndefined()
        expect(focusStyles(quarter, { w: 1000, h: 800 }, { w: 0, h: 500 }, 1)).toBeUndefined()
        expect(focusStyles(quarter, { w: 1000, h: 800 }, { w: 1000, h: 0 }, 1)).toBeUndefined()
        expect(focusStyles({ ...quarter, width: 0 }, { w: 1000, h: 800 }, { w: 1000, h: 500 }, 1)).toBeUndefined()
        expect(focusStyles({ ...quarter, height: 0 }, { w: 1000, h: 800 }, { w: 1000, h: 500 }, 1)).toBeUndefined()
    })
})

describe("config reducer - zoomToClasses", () => {
    const initial = ConfigReduce(undefined, { type: "@@INIT" })

    it("starts off", () => {
        expect(initial.zoomToClasses).toBe('off')
    })

    it("setZoomToClasses stores each mode", () => {
        for (const mode of ['all', 'focus', 'off'] as ZoomToClassesMode[]) {
            const action = setZoomToClasses(mode)
            expect(action).toEqual({ type: 'config/setZoomToClasses', payload: mode })
            expect(ConfigReduce(initial, action).zoomToClasses).toBe(mode)
        }
    })

    it("toggling through nextZoomMode leaves the rest of the config alone", () => {
        let state = initial
        for (const pressed of ['all', 'focus', 'focus', 'focus', 'all'] as const) {
            state = ConfigReduce(state, setZoomToClasses(nextZoomMode(state.zoomToClasses, pressed)))
        }
        // all -> focus -> off -> focus -> all
        expect(state.zoomToClasses).toBe('all')
        expect({ ...state, zoomToClasses: initial.zoomToClasses }).toEqual(initial)
    })
})
