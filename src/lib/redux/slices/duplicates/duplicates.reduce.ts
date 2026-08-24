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
    dbImporting: boolean
    dbImportError: string | null
    // How many cross-folder duplicate files the last import matched
    // (null until an import succeeds; 0 means "imported fine, nothing matched").
    dbImportMatched: number | null
    // Cached video/GIF frame paths (compareImg's duplicate-finder indexing),
    // keyed by mediaId, for the duplicates grid's 4-frame collage thumbnail.
    // A media with no entry here (or an empty array) falls back to a plain
    // thumbnail - either it's an image, or its frames were never extracted.
    mediaFrames: Record<string, string[]>
}

const initialState: DuplicatesState = {
    groups: [],
    indexRebuilding: false,
    indexRebuildError: null,
    indexRebuildProgress: null,
    dbExporting: false,
    dbExportError: null,
    lastDbExportPath: null,
    dbImporting: false,
    dbImportError: null,
    dbImportMatched: null,
    mediaFrames: {},
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
        startDatabaseImport: (state) => ({
            ...state,
            dbImporting: true,
            dbImportError: null,
            dbImportMatched: null,
        }),
        databaseImportFinished: (state, action) => ({
            ...state,
            dbImporting: false,
            dbImportError: action.payload.error ?? null,
            dbImportMatched: action.payload.matched ?? null,
        }),
        // Merges rather than replaces so frames fetched for one batch of
        // loaded media are not clobbered by a later, smaller batch.
        setMediaFrames: (state, action) => ({
            ...state,
            mediaFrames: {
                ...state.mediaFrames,
                ...Object.fromEntries(
                    action.payload.items.map((item: { id: string, frames: string[] }) => [item.id, item.frames])
                ),
            },
        }),
    }
})

export const { setDuplicateGroups, clearDuplicateGroups, startIndexRebuild, setIndexRebuildProgress, indexRebuildFinished, startDatabaseExport, databaseExportFinished, startDatabaseImport, databaseImportFinished, setMediaFrames } = duplicatesSlice.actions;
export default duplicatesSlice.reducer;
