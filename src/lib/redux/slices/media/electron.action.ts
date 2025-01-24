import { ElectronService } from 'ngx-electron';
import { addListinActualArray, orderByFolder, orderByName, orderBySize, populateArray, updateArrayItem } from './media.reduce';
import { example } from './populateExample';
import { Media } from '../../../../entity/Media';
import { addFolder } from '../folders';
import { zoomIn, zoomOut } from '../configurations';


const isElectronApp = new ElectronService().isElectronApp;
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
            ipcRender.on('directoryOpen', (e: any, args: any) => {

                console.log("Receive files ", args.length);

                dispatch(populateArray(args))

            })

            ipcRender.on('loadMedias', (e: any, args: any) => {

                console.log("Receive upgrades ", args.length);

                dispatch(addListinActualArray(args))

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
                    case 'sortByName': dispatch(orderByName(sort)); break;
                    case 'sortBySize': dispatch(orderBySize(sort)); break;
                    case 'sortByFolder': dispatch(orderByFolder(sort)); break;
                
                    default:
                        break;
                }
            })
            ipcRender.on('menuOpen', (e: any, folders: string[]) => {
                folders.forEach(folder => dispatch(addFolder(folder)))
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

