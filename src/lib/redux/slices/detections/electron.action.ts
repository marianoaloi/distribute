import { Media } from "../../../../entity/Media";
import { startDetecting } from "./detections.reduce";

const isElectronApp = typeof window !== 'undefined' && !!window.electron;
const ipcRender = isElectronApp ? window.electron.ipcRenderer : undefined;

// Runs ONNX object detection (objectDetection/onnxDetector.js, model in
// ./xcxv) over the given media, streaming one result back per item via the
// 'detectionFound' listener registered in media/electron.action.ts.
export const RunDetection = (medias: Media[]) => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }

    return (dispatch: any) => {
        dispatch(startDetecting());
        if (ipcRender) {
            ipcRender.send('detectObjects', {
                medias: medias.map(m => ({ id: m.id, media: m.media }))
            });
        }
    }
}
