import { changeCheckedReducer, pullMediaReducer, } from "./slices";




export const reducer = {
    rootMedia: pullMediaReducer,
    changeMedia: changeCheckedReducer
}