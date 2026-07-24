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

// Fired by the main process around the video-thumbnail streaming phase of
// opening a folder (util.js's transformDataStreaming) — the grid can still
// be filling in one video at a time well after mediaLoadStart, with no other
// signal available to tell whether it's finished.
export const mediaLoadStart = createAction(
    'config/mediaLoadStart'
)

export const mediaLoadComplete = createAction(
    'config/mediaLoadComplete'
)