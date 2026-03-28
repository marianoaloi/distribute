import { createReducer } from "@reduxjs/toolkit"
import { setMediaType, zoomIn, zoomOut } from "./thunks"


interface Config {
    pxzoom: number
    mediaType?: 'image' | 'video' | undefined
}

const initialState: Config = {
    pxzoom: 200
}

export const ConfigReduce = createReducer(initialState, (build) => {
    build.addCase(zoomIn, (state, action) => ({
        ...state,
        pxzoom: state.pxzoom + 50
    }))
    build.addCase(zoomOut, (state, action) => ({
        ...state,
        pxzoom: state.pxzoom - 50
    }))
    build.addCase(setMediaType, (state, action) => ({
        ...state,
        mediaType: action.payload 
    }))
})
