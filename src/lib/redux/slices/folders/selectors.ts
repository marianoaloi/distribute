import { ReduxState } from "../../store";



export const workFolder = (state: ReduxState) => state.folderWork.folders
export const splitMoveUncheckedFolder = (state: ReduxState) => state.folderWork.splitMoveUncheckedFolder
export const splitMoveCheckedFolder = (state: ReduxState) => state.folderWork.splitMoveCheckedFolder