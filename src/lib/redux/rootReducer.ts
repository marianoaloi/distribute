import { ConfigReduce } from "./slices/configurations";
import { FolderReduce } from "./slices/folders";
import rootReducerMedia from "./slices/media/media.reduce";




export const reducer = {
    rootMedia: rootReducerMedia,
    folderWork: FolderReduce,
    configuration: ConfigReduce,
}