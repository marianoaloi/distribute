import { ReduxState } from "../../store";

export const selectCanUndo = (state: ReduxState) => state.undo.canUndo;
export const selectUndoLabel = (state: ReduxState) => state.undo.label;
export const selectUndoLastRestored = (state: ReduxState) => state.undo.lastRestored;
export const selectUndoLastSkipped = (state: ReduxState) => state.undo.lastSkipped;
