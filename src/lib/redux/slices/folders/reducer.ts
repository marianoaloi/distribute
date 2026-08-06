import { createReducer, WritableDraft } from "@reduxjs/toolkit"
import { addFolder, removeFolder, setSplitMoveCheckedFolder, setSplitMoveUncheckedFolder } from "./thunks"


interface FoldersDistribute {
    folders: string[]
    splitMoveUncheckedFolder: string
    splitMoveCheckedFolder: string
}

const initialState: FoldersDistribute = {
    folders: ["L", "R"],
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



