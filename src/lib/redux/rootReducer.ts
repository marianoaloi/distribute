import { ConfigReduce } from "./slices/configurations";
import { FolderReduce } from "./slices/folders";
import rootReducerMedia from "./slices/media/media.reduce";
import rootReducerDuplicates from "./slices/duplicates/duplicates.reduce";




export const reducer = {
    rootMedia: rootReducerMedia,
    folderWork: FolderReduce,
    configuration: ConfigReduce,
    duplicates: rootReducerDuplicates,
}