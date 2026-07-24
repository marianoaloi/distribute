import { addListinActualArray, addOnceMedia, orderByFolder, orderByName, orderBySize, populateArray, purgeArray, updateArrayItem } from './media.reduce';
import { example } from './populateExample';
import { Media } from '../../../../entity/Media';
import { addFolder } from '../folders';
import { mediaLoadComplete, mediaLoadStart, zoomIn, zoomOut } from '../configurations';
import { setDuplicateGroups, indexRebuildFinished, setIndexRebuildProgress } from '../duplicates';
import { FileDTO } from '../../../../entity/FileDTO';


const isElectronApp = typeof window !== 'undefined' && !!window.electron;
const ipcRender = isElectronApp ? window.electron.ipcRenderer : undefined;

export const ElectronConnection = () => {

    if (!isElectronApp) {
        return (dispatch: any) => {

            // dispatch({ type: 'media/transformStringToMedia', payload: example })
            dispatch(populateArray(example))
        }
    }


    return (dispatch: any) => {
        if (ipcRender) {
            const channels = ['directoryOpen', 'loadMedias', 'addOneMedia', 'delete', 'zoom', 'sort', 'menuOpen', 'cleanGrid', 'duplicatesFound', 'indexRebuilt', 'indexRebuildProgress', 'mediaLoadStart', 'mediaLoadComplete'];
            channels.forEach(ch => ipcRender.removeAllListeners(ch));

            ipcRender.on('directoryOpen', (e: any, args: any) => {

                console.log("Receive files ", args.length);

                dispatch(populateArray(args))

            })

            ipcRender.on('loadMedias', (e: any, args: any) => {

                console.log("Receive upgrades ", args.length , " from ", e.sender.id, " with channel ", e.channel, " ids ", args.map((a:Media) => a.id));

                dispatch(addListinActualArray(args))

            })

            ipcRender.on("addOneMedia", (e: any, media: FileDTO) => {

                // console.log("Receive one media ", media.id);

                dispatch(addOnceMedia(media))

            })

            ipcRender.on('delete', (e: any, med: Media) => {

                med.deleted = true
                dispatch(updateArrayItem(med))

            })
            ipcRender.on('zoom', (e: any, zoom: number) => {

                dispatch(zoom > 0 ? zoomIn() : zoomOut())

            })
            ipcRender.on('sort', (e:any,sort:string)=>{
                switch (sort) {
                    case 'sortByName': dispatch(orderByName()); break;
                    case 'sortBySize': dispatch(orderBySize()); break;
                    case 'sortByFolder': dispatch(orderByFolder()); break;

                    default:
                        break;
                }
            })
            ipcRender.on('menuOpen', (e: any, folders: string[]) => {
                folders.forEach(folder => dispatch(addFolder(folder)))
            })
            ipcRender.on('cleanGrid', () => {
                dispatch(purgeArray())
            })
            ipcRender.on('duplicatesFound', (e: any, groups: number[][]) => {
                dispatch(setDuplicateGroups(groups))
            })
            ipcRender.on('indexRebuilt', (e: any, result: { success: boolean, error?: string }) => {
                dispatch(indexRebuildFinished(result.success ? null : (result.error || 'Rebuild failed')))
            })
            ipcRender.on('indexRebuildProgress', (e: any, progress: { processed: number, total: number }) => {
                dispatch(setIndexRebuildProgress(progress))
            })
            ipcRender.on('mediaLoadStart', () => {
                dispatch(mediaLoadStart())
            })
            ipcRender.on('mediaLoadComplete', () => {
                dispatch(mediaLoadComplete())
            })
            ipcRender.send("verifyOpen", undefined)
        }
    }
}


export const OpenDirectory = () => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }


    return (dispatch: any) => {
        if (ipcRender)
            ipcRender.send('open', new Date().toISOString());
    }
}

export const OpenDirectoryRecursive = () => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }


    return (dispatch: any) => {
        if (ipcRender)
            ipcRender.send('openRecursive', new Date().toISOString());
    }
}

export const SendSelectedFiles = (folder: string, onlyCopy: boolean, data: Media[]) => {


    if (!isElectronApp) {

        console.log(folder, data)

    }


    if (ipcRender) {
        ipcRender.send('process', { folder: folder, onlyCopy: onlyCopy, data: data });
    }


}

