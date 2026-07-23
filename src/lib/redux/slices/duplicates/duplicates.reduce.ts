import { createSlice } from "@reduxjs/toolkit";

interface DuplicatesState {
    groups: number[][]
}

const initialState: DuplicatesState = {
    groups: []
}

const duplicatesSlice = createSlice({
    name: "duplicates",
    initialState,
    reducers: {
        setDuplicateGroups: (state, action) => ({
            ...state,
            groups: action.payload
        }),
        clearDuplicateGroups: (state) => ({
            ...state,
            groups: []
        }),
    }
})

export const { setDuplicateGroups, clearDuplicateGroups } = duplicatesSlice.actions;
export default duplicatesSlice.reducer;
