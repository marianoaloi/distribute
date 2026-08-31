import { ConfigReduce } from "./slices/configurations";
import { FolderReduce } from "./slices/folders";
import rootReducerMedia from "./slices/media/media.reduce";
import rootReducerDuplicates from "./slices/duplicates/duplicates.reduce";
import rootReducerDetections from "./slices/detections/detections.reduce";
import rootReducerPipeline from "./slices/pipeline/pipeline.reduce";
import rootReducerUndo from "./slices/undo/undo.reduce";




export const reducer = {
    rootMedia: rootReducerMedia,
    folderWork: FolderReduce,
    configuration: ConfigReduce,
    duplicates: rootReducerDuplicates,
    detections: rootReducerDetections,
    pipeline: rootReducerPipeline,
    undo: rootReducerUndo,
}