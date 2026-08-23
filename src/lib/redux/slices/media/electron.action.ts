import { addListinActualArray, addOnceMedia, confirmFileMoved, orderByFolder, orderByName, orderBySize, orderBySizeInverted, populateArray, purgeArray, updateArrayItem } from './media.reduce';
import { example } from './populateExample';
import { Media } from '../../../../entity/Media';
import { addFolder } from '../folders';
import { mediaLoadComplete, mediaLoadStart, zoomIn, zoomOut } from '../configurations';
import { setDuplicateGroups, indexRebuildFinished, setIndexRebuildProgress, databaseExportFinished, databaseImportFinished, setMediaFrames } from '../duplicates';
import { setDetectionResult, mergeDetections, setDetectionProgress, detectingFinished, setModelPath, setDetectionClasses, setDetectionSize } from '../detections';
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
            const channels = ['directoryOpen', 'loadMedias', 'addOneMedia', 'delete', 'zoom', 'sort', 'menuOpen', 'cleanGrid', 'duplicatesFound', 'indexRebuilt', 'indexRebuildProgress', 'mediaLoadStart', 'mediaLoadComplete', 'detectionFound', 'detectionProgress', 'detectionsComplete', 'onnxModelChosen', 'databaseExported', 'databaseImported', 'detectionClassesLoaded', 'detectionsLoaded', 'fileProcessed', 'mediaFramesFound', 'detectionSizeLoaded'];
            channels.forEach(ch => ipcRender.removeAllListeners(ch));

            ipcRender.on('directoryOpen', (e: any, args: any) => {

                // console.log("Receive files ", args.length);

                dispatch(populateArray(args))

            })

            ipcRender.on('loadMedias', (e: any, args: any) => {

                // console.log("Receive upgrades ", args.length , " from ", e.sender.id, " with channel ", e.channel, " ids ", args.map((a:Media) => a.id));

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
            // app.js's moveFile reports this once the physical copy/rename
            // (or the EXDEV copy+unlink fallback) actually finishes - only a
            // successful MOVE (never a copy) hides the item, and only after
            // the fact, so a failed move leaves it visible instead of the
            // grid lying about a file that's still in the source folder.
            ipcRender.on('fileProcessed', (e: any, result: { id: string, onlyCopy?: boolean, success: boolean, error?: string }) => {
                if (result.success && !result.onlyCopy) {
                    dispatch(confirmFileMoved({ id: result.id }))
                } else if (!result.success) {
                    console.error("File operation failed for media", result.id, result.error)
                }
            })
            ipcRender.on('zoom', (e: any, zoom: number) => {

                dispatch(zoom > 0 ? zoomIn() : zoomOut())

            })
            ipcRender.on('sort', (e:any,sort:string)=>{
                switch (sort) {
                    case 'sortByName': dispatch(orderByName()); break;
                    case 'sortBySize': dispatch(orderBySize()); break;
                    case 'sortBySizeInverted': dispatch(orderBySizeInverted()); break;
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
            ipcRender.on('duplicatesFound', (e: any, groups: string[][]) => {
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
            ipcRender.on('detectionFound', (e: any, result: { id: string, boxes: any[], classes: string[] }) => {
                dispatch(setDetectionResult(result))
            })
            ipcRender.on('detectionProgress', (e: any, progress: { processed: number, total: number }) => {
                dispatch(setDetectionProgress(progress))
            })
            ipcRender.on('detectionsComplete', (e: any, result: { error?: string }) => {
                dispatch(detectingFinished(result))
            })
            ipcRender.on('onnxModelChosen', (e: any, result: { path: string | null, size: number }) => {
                dispatch(setModelPath(result.path))
                dispatch(setDetectionSize(result.size))
            })
            ipcRender.on('detectionClassesLoaded', (e: any, result: { names: string[] }) => {
                dispatch(setDetectionClasses(result.names))
            })
            ipcRender.on('detectionSizeLoaded', (e: any, result: { size: number }) => {
                dispatch(setDetectionSize(result.size))
            })
            ipcRender.on('detectionsLoaded', (e: any, result: { items: { id: string, boxes: any[], classes: string[] }[] }) => {
                dispatch(mergeDetections(result))
            })
            ipcRender.on('databaseExported', (e: any, result: { success: boolean, path?: string, error?: string, canceled?: boolean }) => {
                dispatch(databaseExportFinished({
                    error: result.canceled ? null : (result.success ? null : (result.error || 'Export failed')),
                    path: result.success ? result.path : undefined,
                }))
            })
            ipcRender.on('mediaFramesFound', (e: any, result: { items: { id: string, frames: string[] }[] }) => {
                dispatch(setMediaFrames(result))
            })
            ipcRender.on('databaseImported', (e: any, result: { success: boolean, matched?: number, error?: string, canceled?: boolean }) => {
                dispatch(databaseImportFinished({
                    error: result.canceled ? null : (result.success ? null : (result.error || 'Import failed')),
                    matched: result.success ? result.matched : undefined,
                }))
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

