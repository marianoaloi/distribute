import { Media } from "../../../../entity/Media";
import { startDetecting } from "./detections.reduce";

const isElectronApp = typeof window !== 'undefined' && !!window.electron;
const ipcRender = isElectronApp ? window.electron.ipcRenderer : undefined;

// Runs ONNX object detection (objectDetection/onnxDetector.js, model chosen
// via ChooseOnnxModel below) over the given media, streaming one result back
// per item via the 'detectionFound' listener registered in media/electron.action.ts.
export const RunDetection = (medias: Media[]) => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }

    return (dispatch: any) => {
        dispatch(startDetecting());
        if (ipcRender) {
            ipcRender.send('detectObjects',null);
        }
    }
}

// Opens a native file dialog (main process) so the user can point detection
// at any .onnx model file instead of the old hardcoded ./xcxv/best.onnx path.
// The chosen path (or the still-unset current one, if canceled) comes back
// through the 'onnxModelChosen' listener in media/electron.action.ts.
export const ChooseOnnxModel = () => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }

    return (dispatch: any) => {
        if (ipcRender) {
            ipcRender.send('chooseOnnxModel', undefined);
        }
    }
}

// Asks the main process to stop after the item currently being detected —
// results already streamed back stay on screen. detectingFinished arrives
// through the normal 'detectionsComplete' listener.
export const StopDetection = () => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }

    return (dispatch: any) => {
        if (ipcRender) {
            ipcRender.send('stopDetection', undefined);
        }
    }
}

// Sends the raw, unsplit comma-separated string typed by the user — the main
// process owns the split/trim/persist so the reply (detectionClassesLoaded,
// handled in media/electron.action.ts) can never drift from the database.
export const SaveDetectionClasses = (classes: string) => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }

    return (dispatch: any) => {
        if (ipcRender) {
            ipcRender.send('saveDetectionClasses', { classes });
        }
    }
}

// index.db is per-folder, so this must be re-dispatched whenever a folder
// finishes loading, not only on mount.
export const LoadDetectionClasses = () => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }

    return (dispatch: any) => {
        if (ipcRender) {
            ipcRender.send('loadDetectionClasses', undefined);
        }
    }
}

// index.db is per-folder, so persisted detections must be re-hydrated whenever
// a folder finishes loading - otherwise the class filter only sees media the
// user re-ran detection on in this session.
export const LoadDetections = () => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }

    return (dispatch: any) => {
        if (ipcRender) {
            ipcRender.send('loadDetections', undefined);
        }
    }
}
