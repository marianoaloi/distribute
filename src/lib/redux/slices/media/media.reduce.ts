import { createReducer } from "@reduxjs/toolkit";
import { Media } from "../../../../entity/Media";
import { changeChecked, pullMediaData } from "./thunks";
import { FileDTO } from "../../../../entity/FileDTO";



interface MainMedia {
    medias: Media[]
}

const initialState: MainMedia = {
    medias: []
}

export const pullMediaReducer = createReducer(initialState, (build) => {
    build.addCase(pullMediaData, (state, action) => ({
        ...state,
        medias: transformStringToMedia(action.payload)
    }))
})


function transformStringToMedia(paths: FileDTO[]): Media[] {
    let indexPath = 0;
    return paths.map(f => { return { "id": indexPath++, "path": f.item, size: f.size, media: f.fileName, mime: f.mime, checked: false, deleted: false } as Media });
}

export const changeCheckedReducer = createReducer(initialState, (build) => {
    build.addCase(changeChecked, (state, action) => ({
        ...state,
        medias: state.medias.map(
            media => {
                console.log(media.id)
                if (media.id === action.payload.id) {
                    media = action.payload
                }
                return media
            }
        )
    }))
})