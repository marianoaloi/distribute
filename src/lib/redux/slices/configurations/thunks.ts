import { createAction } from "@reduxjs/toolkit";


export const zoomIn = createAction(
    'config/zoomIn'
)

export const zoomOut = createAction(
    'config/zoomOut'
)

export const setMediaType = createAction(
    'config/setMediaType',
    (mediaType: 'video' | 'image' | 'gif' | undefined) => ({
        payload: mediaType
    })
)

export const setPage = createAction(
    'config/setPage',
    (page: number) => ({
        payload: page
    })
)