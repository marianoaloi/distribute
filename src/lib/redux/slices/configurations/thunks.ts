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

// Remembered so the next video opened in the zoom modal (this one or the
// next media the user navigates to) starts at the volume the user left off at.
export const setVideoVolume = createAction(
    'config/setVideoVolume',
    (volume: number) => ({
        payload: volume
    })
)

export const setPage = createAction(
    'config/setPage',
    (page: number) => ({
        payload: page
    })
)

export const setPostsPerPage = createAction(
    'config/setPostsPerPage',
    (postsPerPage: number) => ({
        payload: postsPerPage
    })
)

// Persisted so the grid restores where the user left off (see persistConfig.ts).
export const setScrollPosition = createAction(
    'config/setScrollPosition',
    (scrollPosition: number) => ({
        payload: scrollPosition
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