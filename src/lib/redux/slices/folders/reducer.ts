import { createReducer, WritableDraft } from "@reduxjs/toolkit"
import { addFolder, removeFolder, resetFolders, setSplitMoveCheckedFolder, setSplitMoveUncheckedFolder } from "./thunks"


interface FoldersDistribute {
    folders: string[]
    splitMoveUncheckedFolder: string
    splitMoveCheckedFolder: string
}

// The built-in destination buttons, also what resetFolders goes back to.
const DEFAULT_FOLDERS = ["L", "R"]

const initialState: FoldersDistribute = {
    folders: DEFAULT_FOLDERS,
    splitMoveUncheckedFolder: "",
    splitMoveCheckedFolder: "",
}

export const FolderReduce = createReducer(initialState, (build) => {
    build.addCase(addFolder, (state, action) => ({
        ...state,
        folders: addFolderTransform(state, action)
    }))
    build.addCase(removeFolder, (state, action) => ({
        ...state,
        folders: removeFolderTransform(state, action)
    }))
    build.addCase(resetFolders, (state) => ({
        ...state,
        folders: DEFAULT_FOLDERS
    }))
    build.addCase(setSplitMoveUncheckedFolder, (state, action) => ({
        ...state,
        splitMoveUncheckedFolder: action.payload
    }))
    build.addCase(setSplitMoveCheckedFolder, (state, action) => ({
        ...state,
        splitMoveCheckedFolder: action.payload
    }))
})

function addFolderTransform(state: WritableDraft<FoldersDistribute>, action: { payload: string; type: string }): string[] {

    const folders = [...state.folders]
    if (action.payload)
        folders.push(action.payload)
    return folders.filter((a, b, c) => c.indexOf(a) === b)
}
function removeFolderTransform(state: WritableDraft<FoldersDistribute>, action: { payload: string; type: string }): string[] {

    return state.folders.filter((fold: string) => fold !== action.payload)
}



