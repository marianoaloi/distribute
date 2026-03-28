import { createAction } from "@reduxjs/toolkit";


export const zoomIn = createAction(
    'config/zoomIn'
)

export const zoomOut = createAction(
    'config/zoomOut'
)

export const setMediaType = createAction(
    'config/setMediaType',
    (mediaType: 'video' | 'image' | undefined) => ({
        payload: mediaType
    })
)