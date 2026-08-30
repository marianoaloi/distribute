import { createSlice } from "@reduxjs/toolkit";
import { Media } from "../../../../entity/Media";
import { FileDTO } from "../../../../entity/FileDTO";

import { createApi } from "@reduxjs/toolkit/query/react";


interface MainMedia {
    medias: Media[]
}

const initialState: MainMedia = {
    medias: []
}

const addOnceMediaHelper = (medias: Media[], media: Media): Media[] => {
    if (medias.find(m => m.id === media.id)) {
        return medias
    }
    const auxMedias = [...medias]
    auxMedias.push(media)
    return auxMedias
}   


const itemsSlice = createSlice({
    name: "medias",
    initialState: initialState,
    reducers: {
        populateArray: (state, action) => ({
            ...state,
            medias: transformStringToMedias(action.payload)
        }),
        addListinActualArray: (state, action) => ({
            ...state,
            medias: state.medias.concat(transformStringToMedias(action.payload))
        }),
        addOnceMedia: (state, action) => ({
            ...state,
            medias: addOnceMediaHelper(state.medias, transformMedia(action.payload))
        }),
        purgeArray: (state) => ({
            ...state,
            medias: []
        }),
        updateArrayItem: (state, action) => ({
            ...state,
            medias: state.medias.map(
                media => {
                    if (media.id === action.payload.id) {
                        media = action.payload
                    }
                    return media
                }
            )
        }),
        updateManyArrayItem: (state, action) => {
            const result = { ...state }
            result.medias = state.medias.map(
                med => action.payload.find((m: { id: string; }) => m.id === med.id) || med
            )
            return result;
        },
        // Only dispatched once app.js's "fileProcessed" event confirms the
        // physical move actually succeeded - never on click, so a failed
        // move (permissions, disk full, locked file) leaves the item visible
        // instead of silently vanishing from the grid while it's still sitting
        // in the source folder.
        confirmFileMoved: (state, action) => ({
            ...state,
            medias: state.medias.map(
                media => media.id === action.payload.id ? { ...media, deleted: true, checked: false } : media
            )
        }),
        // The reverse, dispatched once the main process has actually renamed
        // the file back to where it came from (app.ts's performUndo) - so a
        // file that could not be restored, because someone moved it out from
        // under the app, stays hidden rather than reappearing as a tile
        // pointing at nothing.
        confirmFileUnmoved: (state, action) => ({
            ...state,
            medias: state.medias.map(
                media => media.id === action.payload.id ? { ...media, deleted: false, checked: false } : media
            )
        }),

        orderByName:(state) => {
            state.medias.sort((a:Media,b:Media) => a.filename.localeCompare(b.filename))
        },
        orderBySize:(state) => {
            state.medias.sort((a:Media,b:Media) => b.size-a.size)
        },
        orderBySizeInverted:(state) => {
            state.medias.sort((a:Media,b:Media) => a.size-b.size)
        },
        orderByFolder:(state) => {
            state.medias.sort((a:Media,b:Media) => a.path.localeCompare(b.path))
        },
    }
})

const transformMedia = (f: FileDTO) => { return { "id": f.id, "path": f.item, size: f.size, media: f.fileName, filename: f.filename, mime: f.mime, checked: false, deleted: false , hash:f.hash , hasAudio: f.hasAudio , imported: f.imported ?? false, screenIndex: 0} as Media }

function transformStringToMedias(paths: FileDTO[]): Media[] {

    return paths.map(transformMedia);
}


export const mediasApi = createApi({
    reducerPath: "mediasApi",
    baseQuery: () => Promise.resolve({ data: [] }),
    endpoints: (builder) => ({
        getMedias: builder.query<Media[], void>({
            query: () => ({ url: '/medias' })
        })
    })
}); 


export const { populateArray, updateArrayItem, updateManyArrayItem, confirmFileMoved, confirmFileUnmoved, addOnceMedia , addListinActualArray, purgeArray ,orderByName, orderBySize, orderBySizeInverted, orderByFolder} = itemsSlice.actions;
export default itemsSlice.reducer;

// Export hooks for usage in functional components, which are
// auto-generated based on the defined endpoints
export const { useGetMediasQuery } = mediasApi;


