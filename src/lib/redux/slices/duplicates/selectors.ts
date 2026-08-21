import { ReduxState } from "../../store";

export const selectDuplicateGroups = (state: ReduxState) => state.duplicates.groups;
export const selectIndexRebuilding = (state: ReduxState) => state.duplicates.indexRebuilding;
export const selectIndexRebuildError = (state: ReduxState) => state.duplicates.indexRebuildError;
export const selectIndexRebuildProgress = (state: ReduxState) => state.duplicates.indexRebuildProgress;
export const selectDbExporting = (state: ReduxState) => state.duplicates.dbExporting;
export const selectDbExportError = (state: ReduxState) => state.duplicates.dbExportError;
export const selectDbImporting = (state: ReduxState) => state.duplicates.dbImporting;
export const selectDbImportError = (state: ReduxState) => state.duplicates.dbImportError;
export const selectDbImportMatched = (state: ReduxState) => state.duplicates.dbImportMatched;
export const selectMediaFrames = (state: ReduxState) => state.duplicates.mediaFrames;
