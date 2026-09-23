import { createSlice } from "@reduxjs/toolkit";

/** One file the undo could not put back, and why. */
export interface UndoSkipped {
    path: string
    reason: string
}

// Mirror of the main process's undo stack (undo/UndoStack.ts), which is the
// only copy of record - it owns the files on disk and media.futurePosition,
// and it has to outlive a renderer reload. Nothing here decides whether an
// undo is possible; it only reflects what the main process reported, so the
// UI can label and enable an in-app affordance the way the Edit menu does.
interface UndoState {
    canUndo: boolean
    label: string
    // Result of the last undo, shown as a transient toast. `skipped` is the
    // part that matters: a file someone moved out from under the app cannot be
    // restored, and the user needs to be told which ones stayed put rather
    // than being left to assume everything came back.
    lastRestored: number | null
    lastSkipped: UndoSkipped[]
    // Outcome of the last "send filed media back into kind folders" run
    // (organize/sortMediaByKind.ts), shown as a transient toast. Lives here
    // rather than in its own slice because it is the same kind of thing: the
    // result of a bulk file move the user needs to see reported.
    sortResult: SortByKindResult | null
}

/** Report from one sortMediaByKind run - see organize/sortMediaByKind.ts. */
export interface SortByKindResult {
    moved: number
    alreadyInPlace: number
    missing: number
    blocked: number
    failed: Array<{ from: string, reason: string }>
}

const initialState: UndoState = {
    canUndo: false,
    label: "Undo",
    lastRestored: null,
    lastSkipped: [],
    sortResult: null,
}

const undoSlice = createSlice({
    name: "undo",
    initialState,
    reducers: {
        setUndoAvailable: (state, action: { payload: { canUndo: boolean, label: string } }) => ({
            ...state,
            canUndo: action.payload.canUndo,
            label: action.payload.label,
        }),
        undoFinished: (state, action: { payload: { restored: number, skipped: UndoSkipped[] } }) => ({
            ...state,
            lastRestored: action.payload.restored,
            lastSkipped: action.payload.skipped,
        }),
        dismissUndoResult: (state) => ({
            ...state,
            lastRestored: null,
            lastSkipped: [],
        }),
        sortByKindFinished: (state, action: { payload: SortByKindResult }) => ({
            ...state,
            sortResult: action.payload,
        }),
        dismissSortResult: (state) => ({
            ...state,
            sortResult: null,
        }),
    }
})

export const { setUndoAvailable, undoFinished, dismissUndoResult, sortByKindFinished, dismissSortResult } = undoSlice.actions;
export default undoSlice.reducer;
