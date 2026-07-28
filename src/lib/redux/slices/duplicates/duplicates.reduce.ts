import { createSlice } from "@reduxjs/toolkit";

interface IndexRebuildProgress {
    processed: number
    total: number
}

interface DuplicatesState {
    groups: string[][]
    indexRebuilding: boolean
    indexRebuildError: string | null
    indexRebuildProgress: IndexRebuildProgress | null
    dbExporting: boolean
    dbExportError: string | null
    lastDbExportPath: string | null
}

const initialState: DuplicatesState = {
    groups: [],
    indexRebuilding: false,
    indexRebuildError: null,
    indexRebuildProgress: null,
    dbExporting: false,
    dbExportError: null,
    lastDbExportPath: null,
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
        startDatabaseExport: (state) => ({
            ...state,
            dbExporting: true,
            dbExportError: null,
        }),
        databaseExportFinished: (state, action) => ({
            ...state,
            dbExporting: false,
            dbExportError: action.payload.error ?? null,
            lastDbExportPath: action.payload.path ?? state.lastDbExportPath,
        }),
    }
})

export const { setDuplicateGroups, clearDuplicateGroups, startIndexRebuild, setIndexRebuildProgress, indexRebuildFinished, startDatabaseExport, databaseExportFinished } = duplicatesSlice.actions;
export default duplicatesSlice.reducer;
