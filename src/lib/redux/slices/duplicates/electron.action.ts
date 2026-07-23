import { Media } from "../../../../entity/Media";

const isElectronApp = typeof window !== 'undefined' && !!window.electron;
const ipcRender = isElectronApp ? window.electron.ipcRenderer : undefined;

export const FindDuplicates = (medias: Media[]) => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }

    return (dispatch: any) => {
        if (ipcRender) {
            ipcRender.send('findDuplicates', {
                medias: medias.map(m => ({ id: m.id, path: m.path, size: m.size }))
            });
        }
    }
}
