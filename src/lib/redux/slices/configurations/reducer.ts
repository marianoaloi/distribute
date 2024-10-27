import { createReducer } from "@reduxjs/toolkit"
import { zoomIn, zoomOut } from "./thunks"


interface Config {
    pxzoom: number
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
})





