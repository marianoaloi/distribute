import { createSlice } from "@reduxjs/toolkit";

interface IndexRebuildProgress {
    processed: number
    total: number
}

interface DuplicatesState {
    groups: number[][]
    indexRebuilding: boolean
    indexRebuildError: string | null
    indexRebuildProgress: IndexRebuildProgress | null
}

const initialState: DuplicatesState = {
    groups: [],
    indexRebuilding: false,
    indexRebuildError: null,
    indexRebuildProgress: null,
}

const duplicatesSlice = createSlice({
    name: "duplicates",
    initialState,
    reducers: {
        setDuplicateGroups: (state, action) => ({
            ...state,
            groups: action.payload
        }),
        clearDuplicateGroups: (state) => ({
            ...state,
            groups: []
        }),
        startIndexRebuild: (state) => ({
            ...state,
            indexRebuilding: true,
            indexRebuildError: null,
            indexRebuildProgress: null,
        }),
        setIndexRebuildProgress: (state, action) => ({
            ...state,
            indexRebuildProgress: action.payload,
        }),
        indexRebuildFinished: (state, action) => ({
            ...state,
            indexRebuilding: false,
            indexRebuildError: action.payload ?? null,
            indexRebuildProgress: null,
        }),
    }
})

export const { setDuplicateGroups, clearDuplicateGroups, startIndexRebuild, setIndexRebuildProgress, indexRebuildFinished } = duplicatesSlice.actions;
export default duplicatesSlice.reducer;
