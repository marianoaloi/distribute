import { createReducer } from "@reduxjs/toolkit"
import { addFolder, removeFolder } from "./thunks"
import { WritableDraft } from "immer/dist/internal"


interface FoldersDistribute {
    folders: string[]
}

const initialState: FoldersDistribute = {
    folders: ["L", "R"]
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
})

function addFolderTransform(state: WritableDraft<FoldersDistribute>, action: { payload: string; type: string }): string[] {

    const folders = [...state.folders]
    if (action.payload)
        folders.push(action.payload)
    return folders.filter((a, b, c) => c.indexOf(a) === b)
}
function removeFolderTransform(state: WritableDraft<FoldersDistribute>, action: { payload: string; type: string }): string[] {

    return state.folders.filter(fold => fold !== action.payload)
}



