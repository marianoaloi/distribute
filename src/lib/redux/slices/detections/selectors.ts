import { ReduxState } from "../../store";

export const selectDetections = (state: ReduxState) => state.detections.byId;
export const selectDetecting = (state: ReduxState) => state.detections.detecting;
export const selectDetectionError = (state: ReduxState) => state.detections.detectionError;
export const selectDetectionProgress = (state: ReduxState) => state.detections.progress;
