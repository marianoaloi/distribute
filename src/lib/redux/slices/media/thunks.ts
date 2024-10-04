import { createAction } from "@reduxjs/toolkit";
import { FileDTO } from "../../../../entity/FileDTO";
import { Media } from "../../../../entity/Media";





export const pullMediaData = createAction<FileDTO[]>(
    'media/transformStringToMedia'
)


export const changeChecked = createAction<Media>(
    'media/changeChecked'
)