import { createReducer } from "@reduxjs/toolkit"
import { mediaLoadComplete, mediaLoadStart, setMediaType, setPage, setPostsPerPage, setScrollPosition, zoomIn, zoomOut } from "./thunks"
import { populateArray } from "../media/media.reduce"
import { loadPersistedConfig } from "./persistConfig"


interface Config {
    pxzoom: number
    mediaType?: 'image' | 'video' | 'gif' | undefined
    page: number
    mediaLoading: boolean
    postsPerPage: number
    scrollPosition: number
}

const initialState: Config = {
    pxzoom: 200,
    page: 0,
    mediaLoading: false,
    postsPerPage: 50,
    scrollPosition: 0,
    ...loadPersistedConfig(),
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
    build.addCase(setPostsPerPage, (state, action) => ({
        ...state,
        postsPerPage: action.payload
    }))
    build.addCase(setScrollPosition, (state, action) => ({
        ...state,
        scrollPosition: action.payload
    }))
    // Opening a new folder fully replaces the media list — go back to page 1.
    build.addCase(populateArray, (state) => ({
        ...state,
        page: 0
    }))
    build.addCase(mediaLoadStart, (state) => ({
        ...state,
        mediaLoading: true
    }))
    build.addCase(mediaLoadComplete, (state) => ({
        ...state,
        mediaLoading: false
    }))
})
