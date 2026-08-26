import { createSlice } from "@reduxjs/toolkit";

// Mirrors pipeline/PipelineRun.ts's snapshot shape on the main process side -
// one unified "a long multi-stage job is running" signal (loadSuperRecursive's
// scan -> hash -> index -> detect -> duplicates chain), independent of the
// per-feature busy flags (duplicates.indexRebuilding, detections.detecting,
// ...) those same stages also still drive for their own pages.
export interface PipelineStageSnapshot {
    key: string
    label: string
    index: number
    count: number
    processed: number
    total: number
    startedAt: number
}

export interface PipelineSnapshot {
    running: boolean
    kind: string | null
    startedAt: number | null
    stage: PipelineStageSnapshot | null
    etaStageMs: number | null
    etaOverallMs: number | null
}

interface PipelineState {
    running: boolean
    kind: string | null
    startedAt: number | null
    stage: PipelineStageSnapshot | null
    etaStageMs: number | null
    etaOverallMs: number | null
    error: string | null
    // A second long operation was refused while this one was running (see
    // app.ts's rejectIfBusy) - shown as a transient toast, not folded into
    // `error` since it isn't this run failing, just a different one being
    // turned away.
    rejectedMessage: string | null
}

const initialState: PipelineState = {
    running: false,
    kind: null,
    startedAt: null,
    stage: null,
    etaStageMs: null,
    etaOverallMs: null,
    error: null,
    rejectedMessage: null,
}

const pipelineSlice = createSlice({
    name: "pipeline",
    initialState,
    reducers: {
        setPipelineProgress: (state, action: { payload: PipelineSnapshot }) => ({
            ...state,
            running: action.payload.running,
            kind: action.payload.kind,
            startedAt: action.payload.startedAt,
            stage: action.payload.stage,
            etaStageMs: action.payload.etaStageMs,
            etaOverallMs: action.payload.etaOverallMs,
        }),
        pipelineFinished: (state, action: { payload: { kind: string, error: string | null } }) => ({
            ...state,
            running: false,
            stage: null,
            etaStageMs: null,
            etaOverallMs: null,
            error: action.payload.error,
        }),
        dismissPipelineError: (state) => ({
            ...state,
            error: null,
        }),
        pipelineRejected: (state, action: { payload: { message: string } }) => ({
            ...state,
            rejectedMessage: action.payload.message,
        }),
        clearPipelineRejected: (state) => ({
            ...state,
            rejectedMessage: null,
        }),
    }
})

export const { setPipelineProgress, pipelineFinished, dismissPipelineError, pipelineRejected, clearPipelineRejected } = pipelineSlice.actions;
export default pipelineSlice.reducer;
