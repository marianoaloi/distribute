import { CSSProperties, SyntheticEvent, useEffect, useState } from "react"
import { DetectionBox } from "../lib/redux/slices/detections/detections.reduce"
import { useDispatch, useSelector } from "../lib/redux"
import { configurationsSelector, setZoomToClasses, ZoomToClassesMode } from "../lib/redux/slices/configurations"
import { useFocusClassNames } from "./classFilter"

// Zoom modal's "zoom to classes" mode: instead of the whole picture, show
// only the rectangle spanned by the media's detected boxes - the topmost and
// bottommost boxes set its height, the leftmost and rightmost its width -
// scaled to fit the media area.

// Normalized (0-1, same as DetectionBox) margin kept around the boxes so the
// outermost ones aren't flush with the edge of the view.
const FOCUS_MARGIN = 0.02

export interface Region { left: number, top: number, width: number, height: number }

export const classesRegion = (boxes: DetectionBox[]): Region | undefined => {
    if (boxes.length === 0) return undefined
    const left = Math.max(0, Math.min(...boxes.map(box => box.x)) - FOCUS_MARGIN)
    const top = Math.max(0, Math.min(...boxes.map(box => box.y)) - FOCUS_MARGIN)
    const right = Math.min(1, Math.max(...boxes.map(box => box.x + box.w)) + FOCUS_MARGIN)
    const bottom = Math.min(1, Math.max(...boxes.map(box => box.y + box.h)) + FOCUS_MARGIN)
    if (!(right > left && bottom > top)) return undefined
    return { left, top, width: right - left, height: bottom - top }
}

// A button / key turns its mode on (switching straight from the other one),
// or off when it is already the current one.
export const nextZoomMode = (current: ZoomToClassesMode, pressed: Exclude<ZoomToClassesMode, 'off'>): ZoomToClassesMode =>
    current === pressed ? 'off' : pressed

// Boxes of the .maloi focus classes only.
export const focusClassBoxes = (boxes: DetectionBox[], focusNames: Set<string>): DetectionBox[] =>
    boxes.filter(box => focusNames.has(box.className))

interface Size { w: number, h: number }

export interface FocusStyles {
    // Clips everything outside the region; centred in the media area while
    // it fits, top-left anchored (so it scrolls) once zoomed past it.
    viewport: CSSProperties
    // ImgWrapper: shifted so the region's corner sits at the viewport's.
    wrapper: CSSProperties
    // The image at its scaled size. The max-size/transform overrides cancel
    // the CleaningServices button's imageAddaptScreen class while focused.
    image: CSSProperties
}

export const focusStyles = (region: Region, natural: Size, view: Size, zoom: number): FocusStyles | undefined => {
    const regionW = region.width * natural.w
    const regionH = region.height * natural.h
    if (!(regionW > 0 && regionH > 0 && view.w > 0 && view.h > 0)) return undefined
    const scale = Math.min(view.w / regionW, view.h / regionH) * zoom
    const imageW = natural.w * scale
    const imageH = natural.h * scale
    const viewportW = Math.floor(regionW * scale)
    const viewportH = Math.floor(regionH * scale)
    return {
        viewport: {
            position: 'absolute',
            left: Math.max(0, (view.w - viewportW) / 2),
            top: Math.max(0, (view.h - viewportH) / 2),
            width: viewportW,
            height: viewportH,
            overflow: 'hidden',
        },
        wrapper: {
            left: -region.left * imageW,
            top: -region.top * imageH,
            overflow: 'visible',
        },
        image: {
            width: imageW,
            height: imageH,
            maxWidth: 'none',
            maxHeight: 'none',
            transform: 'none',
        },
    }
}

// Owns the mode (the configuration's zoomToClasses): 'all' zooms to every box
// (header button / W), 'focus' only to the .maloi focus classes' boxes (header
// button / E), while the modal is open. Tracks the media area's size and
// the image's natural size, and returns the focus styles while a mode is on and
// it has boxes to show - undefined otherwise, so the modal falls back to the
// whole picture.
export const useClassesFocus = (open: boolean, boxes: DetectionBox[], src: string, zoom: number) => {
    const dispatch = useDispatch()
    const mode = useSelector(configurationsSelector).zoomToClasses
    const toggle = (pressed: Exclude<ZoomToClassesMode, 'off'>): void => { dispatch(setZoomToClasses(nextZoomMode(mode, pressed))) }
    const focusNames = useFocusClassNames()
    const focusBoxes = focusClassBoxes(boxes, focusNames)
    const [container, setContainer] = useState<HTMLElement | null>(null)
    const [view, setView] = useState<Size>({ w: 0, h: 0 })
    // Keyed by src so the previous media's size is never applied to the next.
    const [natural, setNatural] = useState<(Size & { src: string }) | null>(null)

    // W toggles 'all', E 'focus', either case (Shift / Caps Lock): Ctrl+W & co. are
    // left alone, so is typing in a text field (e.g. FoldersZoom's new-folder name),
    // and a held key toggles once. Not toLowerCase: autofill keydowns have no key.
    useEffect(() => {
        if (!open) return
        const onKeyDown = (ev: KeyboardEvent) => {
            const pressed: Exclude<ZoomToClassesMode, 'off'> | undefined =
                ev.key === 'w' || ev.key === 'W' ? 'all' : ev.key === 'e' || ev.key === 'E' ? 'focus' : undefined
            if (!pressed || ev.repeat || ev.ctrlKey || ev.altKey || ev.metaKey) return
            const target = ev.target as HTMLElement | null
            if (target?.closest?.('input:not([type="checkbox"]), textarea, [contenteditable="true"]')) return
            dispatch(setZoomToClasses(nextZoomMode(mode, pressed)))
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [open, mode, dispatch])

    useEffect(() => {
        if (!container) return
        const update = () => setView({ w: container.clientWidth, h: container.clientHeight })
        update()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(update)
        observer.observe(container)
        return () => observer.disconnect()
    }, [container])

    const onImageLoad = (event: SyntheticEvent<HTMLImageElement>): void => {
        const img = event.currentTarget
        setNatural({ src, w: img.naturalWidth, h: img.naturalHeight })
    }

    const region = mode === 'all' ? classesRegion(boxes) : mode === 'focus' ? classesRegion(focusBoxes) : undefined
    const styles = region && natural?.src === src ? focusStyles(region, natural, view, zoom) : undefined
    const missing = focusNames.size === 0 ? 'this folder has no .maloi focus classes'
        : focusBoxes.length === 0 ? 'no focus class detected on this media' : ''
    const titles = {
        all: mode === 'all' ? 'Show the whole image (W)' : 'Zoom the image to the area of all its detected classes (W)',
        focus: mode !== 'focus' ? `Zoom the image to the area of its .maloi focus classes${missing && ` - ${missing}`} (E)`
            : missing ? `Zoom to focus classes is on, but ${missing}: showing the whole image (E)` : 'Show the whole image (E)',
    }
    return { mode, toggle, titles, containerRef: setContainer, onImageLoad, styles }
}
