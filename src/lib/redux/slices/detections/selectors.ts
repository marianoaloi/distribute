import { ReduxState } from "../../store";

export const selectDetections = (state: ReduxState) => state.detections.byId;
export const selectDetecting = (state: ReduxState) => state.detections.detecting;
export const selectDetectionError = (state: ReduxState) => state.detections.detectionError;
export const selectDetectionProgress = (state: ReduxState) => state.detections.progress;
export const selectModelPath = (state: ReduxState) => state.detections.modelPath;
export const selectDetectionClassNames = (state: ReduxState) => state.detections.classNames;
export const selectLastProcessedId = (state: ReduxState) => state.detections.lastProcessedId;
