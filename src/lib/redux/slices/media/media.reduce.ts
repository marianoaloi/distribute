import { createSlice } from "@reduxjs/toolkit";
import { Media } from "../../../../entity/Media";
import { FileDTO } from "../../../../entity/FileDTO";



interface MainMedia {
    medias: Media[]
}

const initialState: MainMedia = {
    medias: []
}
/*
const pullMediaReducer = createReducer(initialState, (build) => {
    build.addCase(pullMediaData, (state, action) => ({
        ...state,
        medias: transformStringToMedia(action.payload)
    }))
})
    */
const itemsSlice = createSlice({
    name: "medias",
    initialState: initialState,
    reducers: {
        populateArray: (state, action) => ({
            ...state,
            medias: transformStringToMedia(action.payload)
        }),
        addListinActualArray: (state, action) => ({
            ...state,
            medias: state.medias.concat(transformStringToMedia(action.payload))
        }),
        purgeArray: (state, action) => ({
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
                med => action.payload.find((m: { id: number; }) => m.id === med.id) || med
            )
            return result;
        },

        orderByName:(state, action) => ({
            ...state,
            medias :state.medias.sort((a:Media,b:Media) => a.media.localeCompare(b.media))
            
        }),
        orderBySize:(state, action) => ({
            ...state,
            medias :state.medias.sort((a:Media,b:Media) => a.size-b.size)
            
        }),
        orderByFolder:(state, action) => ({
            ...state,
            medias :state.medias.sort((a:Media,b:Media) => a.path.localeCompare(b.path))
            
        }),
    }
})

function transformStringToMedia(paths: FileDTO[]): Media[] {

    return paths.map(f => { return { "id": f.id, "path": f.item, size: f.size, media: f.fileName, mime: f.mime, checked: false, deleted: false } as Media });
}



export const { populateArray, updateArrayItem, updateManyArrayItem, addListinActualArray, purgeArray ,orderByName, orderBySize, orderByFolder} = itemsSlice.actions;
export default itemsSlice.reducer;

function reIdList(medias: Media[]): Media[] {
    return medias;
}
