import { Media } from "../../../../entity/Media";
import { startIndexRebuild, startDatabaseExport, startDatabaseImport } from "./duplicates.reduce";

const isElectronApp = typeof window !== 'undefined' && !!window.electron;
const ipcRender = isElectronApp ? window.electron.ipcRenderer : undefined;

// Perceptual duplicates: groups media whose cropped/greyscale frame pixels
// are within a mean-difference threshold (compareImg/duplicateFinder.js),
// regardless of byte-identical content.
export const FindIndexDuplicates = () => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }

    return (dispatch: any) => {
        if (ipcRender) {
            ipcRender.send('findIndexDuplicates', undefined);
        }
    }
}

// Loads whatever the last scan persisted (items_duplicated table) instead of
// re-running the slow O(n^2) comparison - call this when the duplicates view
// opens so it can show its last result immediately.
export const GetDuplicateGroups = () => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }

    return (dispatch: any) => {
        if (ipcRender) {
            ipcRender.send('getDuplicateGroups', undefined);
        }
    }
}

// Recovers from a corrupted compareImg vector index (e.g. "Unexpected end of
// JSON input" from a truncated index.json): wipes the index on disk and
// re-indexes it from the media already loaded in redux, so the user doesn't
// have to re-open/re-scan the folder.
export const RebuildIndex = (medias: Media[]) => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }

    return (dispatch: any) => {
        dispatch(startIndexRebuild());
        if (ipcRender) {
            ipcRender.send('rebuildIndex', {
                medias: medias.map(m => ({ id: m.id, path: m.path, mime: m.mime }))
            });
        }
    }
}

// Exports the compareImg sqlite index to a file the user picks, for later
// import/comparison against another library's index (a follow-up feature).
export const ExportDatabase = () => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }

    return (dispatch: any) => {
        dispatch(startDatabaseExport());
        if (ipcRender) {
            ipcRender.send('exportDatabase', undefined);
        }
    }
}

// Frame paths for the duplicates grid's 4-frame collage thumbnail (video/GIF
// media only - see app.js's getMediaFrames handler). Read-only: never
// triggers ffmpeg extraction, so it's safe to call whenever medias load.
export const GetMediaFrames = (medias: Media[]) => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }

    return (dispatch: any) => {
        if (ipcRender) {
            ipcRender.send('getMediaFrames', {
                medias: medias.map(m => ({ id: m.id, media: m.media }))
            });
        }
    }
}

// Imports another folder's exported index database (readonly, never merged
// into this folder's index) and streams back cross-folder duplicates as
// transient fake items — see app.js's importDatabase handler.
export const ImportDatabase = () => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }

    return (dispatch: any) => {
        dispatch(startDatabaseImport());
        if (ipcRender) {
            ipcRender.send('importDatabase', undefined);
        }
    }
}
