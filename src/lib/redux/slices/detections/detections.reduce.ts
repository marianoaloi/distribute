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
}

const initialState: DetectionsState = {
    byId: {},
    detecting: false,
    detectionError: null,
    progress: null,
    modelPath: null,
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
        }),
        setDetectionResult: (state, action) => ({
            ...state,
            byId: { ...state.byId, [action.payload.id]: action.payload.boxes },
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
        }),
        setModelPath: (state, action) => ({
            ...state,
            modelPath: action.payload,
        }),
    }
})

export const { startDetecting, setDetectionResult, setDetectionProgress, detectingFinished, clearDetections, setModelPath } = detectionsSlice.actions;
export default detectionsSlice.reducer;
