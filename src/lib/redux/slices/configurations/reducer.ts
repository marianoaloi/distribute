import { createReducer } from "@reduxjs/toolkit"
import { setMediaType, setPage, zoomIn, zoomOut } from "./thunks"
import { populateArray } from "../media/media.reduce"


interface Config {
    pxzoom: number
    mediaType?: 'image' | 'video' | 'gif' | undefined
    page: number
}

const initialState: Config = {
    pxzoom: 200,
    page: 0
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
    build.addCase(setPage, (state, action) => ({
        ...state,
        page: action.payload
    }))
    // Opening a new folder fully replaces the media list — go back to page 1.
    build.addCase(populateArray, (state) => ({
        ...state,
        page: 0
    }))
})
