import { createAction } from "@reduxjs/toolkit";


export const addFolder = createAction<string>(
    'folder/add'
)

export const removeFolder = createAction<string>(
    'folder/remove'
)