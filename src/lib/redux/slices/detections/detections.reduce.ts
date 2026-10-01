import { createSlice } from "@reduxjs/toolkit";

export interface DetectionBox {
    x: number
    y: number
    w: number
    h: number
    score: number
    classId: number
    className: string
}

interface DetectionProgress {
    processed: number
    total: number
}

// boxes: overlay for the detection grid, sourced from the media's single
// "display item" (the sole item for an image, the end10s frame item for a
// video/GIF) so x/y/w/h stay spatially valid against the displayed
// thumbnail. classes: the union of classes across EVERY item linked to the
// media (all 4 video/GIF frames), for classFilter/gridImg's "does this media
// contain X anywhere" filtering - a superset of boxes' classNames.
// classScores: per class, the min/max detection score across those same items,
// for the class filter's per-term score threshold.
export type ClassScoreRange = { min: number; max: number }

export interface MediaDetections {
    boxes: DetectionBox[]
    classes: string[]
    classScores: Record<string, ClassScoreRange>
}

interface DetectionsState {
    byId: Record<string, MediaDetections>
    detecting: boolean
    detectionError: string | null
    progress: DetectionProgress | null
    modelPath: string | null
    classNames: string[]
    lastProcessedId: string | null
    // Letterbox/tensor input resolution actually in effect (see
    // objectDetection/onnxDetector.js's getSize): the .maloi "reshape"
    // override if one's active, else the user-set value, else 640. Null
    // until the first detectionSizeLoaded reply arrives.
    detectionSize: number | null
}

const initialState: DetectionsState = {
    byId: {},
    detecting: false,
    detectionError: null,
    progress: null,
    modelPath: null,
    classNames: [],
    lastProcessedId: null,
    detectionSize: null,
}

const detectionsSlice = createSlice({
    name: "detections",
    initialState,
    reducers: {
        startDetecting: (state) => ({
            ...state,
            detecting: true,
            detectionError: null,
            progress: null,
            lastProcessedId: null,
        }),
        setDetectionResult: (state, action) => ({
            ...state,
            byId: {
                ...state.byId,
                [action.payload.id]: { boxes: action.payload.boxes, classes: action.payload.classes || [], classScores: action.payload.classScores || {} },
            },
            lastProcessedId: action.payload.id,
        }),
        // Bulk hydration from the folder's persisted item_detection rows. Merges so
        // results streamed by an in-flight detection run are not clobbered.
        mergeDetections: (state, action) => ({
            ...state,
            byId: {
                ...state.byId,
                ...Object.fromEntries(
                    action.payload.items.map((item: { id: string, boxes: DetectionBox[], classes: string[], classScores?: Record<string, ClassScoreRange> }) =>
                        [item.id, { boxes: item.boxes, classes: item.classes || [], classScores: item.classScores || {} }])
                ),
            },
        }),
        // A media whose id changed (organize/sortMediaByKind.ts relocates it
        // and media ids are md5(path)) keeps its overlay under the new id.
        rekeyDetections: (state, action) => {
            const { id, newId } = action.payload
            if (!(id in state.byId)) return state
            const { [id]: moved, ...rest } = state.byId
            return { ...state, byId: { ...rest, [newId]: moved } }
        },
        setDetectionProgress: (state, action) => ({
            ...state,
            progress: action.payload,
        }),
        detectingFinished: (state, action) => ({
            ...state,
            detecting: false,
            detectionError: action.payload?.error ?? null,
            progress: null,
        }),
        clearDetections: (state) => ({
            ...state,
            byId: {},
            lastProcessedId: null,
        }),
        setModelPath: (state, action) => ({
            ...state,
            modelPath: action.payload,
        }),
        setDetectionClasses: (state, action) => ({
            ...state,
            classNames: action.payload,
        }),
        setDetectionSize: (state, action) => ({
            ...state,
            detectionSize: action.payload,
        }),
    }
})

export const { startDetecting, setDetectionResult, mergeDetections, rekeyDetections, setDetectionProgress, detectingFinished, clearDetections, setModelPath, setDetectionClasses, setDetectionSize } = detectionsSlice.actions;
export default detectionsSlice.reducer;
