import { createSlice } from "@reduxjs/toolkit";

interface DuplicatesState {
    groups: number[][]
    indexRebuilding: boolean
    indexRebuildError: string | null
}

const initialState: DuplicatesState = {
    groups: [],
    indexRebuilding: false,
    indexRebuildError: null,
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
        }),
        indexRebuildFinished: (state, action) => ({
            ...state,
            indexRebuilding: false,
            indexRebuildError: action.payload ?? null,
        }),
    }
})

export const { setDuplicateGroups, clearDuplicateGroups, startIndexRebuild, indexRebuildFinished } = duplicatesSlice.actions;
export default duplicatesSlice.reducer;
