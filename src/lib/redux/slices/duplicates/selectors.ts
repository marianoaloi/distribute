import { ReduxState } from "../../store";

export const selectDuplicateGroups = (state: ReduxState) => state.duplicates.groups;
export const selectIndexRebuilding = (state: ReduxState) => state.duplicates.indexRebuilding;
export const selectIndexRebuildError = (state: ReduxState) => state.duplicates.indexRebuildError;
export const selectIndexRebuildProgress = (state: ReduxState) => state.duplicates.indexRebuildProgress;
