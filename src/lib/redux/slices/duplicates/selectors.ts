import { ReduxState } from "../../store";

export const selectDuplicateGroups = (state: ReduxState) => state.duplicates.groups;
