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

interface DetectionsState {
    byId: Record<string, DetectionBox[]>
    detecting: boolean
    detectionError: string | null
    progress: DetectionProgress | null
    modelPath: string | null
    classNames: string[]
    lastProcessedId: string | null
}

const initialState: DetectionsState = {
    byId: {},
    detecting: false,
    detectionError: null,
    progress: null,
    modelPath: null,
    classNames: [],
    lastProcessedId: null,
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
            byId: { ...state.byId, [action.payload.id]: action.payload.boxes },
            lastProcessedId: action.payload.id,
        }),
        // Bulk hydration from the folder's persisted media_detection rows. Merges so
        // results streamed by an in-flight detection run are not clobbered.
        mergeDetections: (state, action) => ({
            ...state,
            byId: {
                ...state.byId,
                ...Object.fromEntries(
                    action.payload.items.map((item: { id: string, boxes: DetectionBox[] }) => [item.id, item.boxes])
                ),
            },
        }),
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
    }
})

export const { startDetecting, setDetectionResult, mergeDetections, setDetectionProgress, detectingFinished, clearDetections, setModelPath, setDetectionClasses } = detectionsSlice.actions;
export default detectionsSlice.reducer;
