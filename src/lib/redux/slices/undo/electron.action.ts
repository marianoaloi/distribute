const isElectronApp = typeof window !== 'undefined' && !!window.electron;
const ipcRender = isElectronApp ? window.electron.ipcRenderer : undefined;

// Asks the main process to reverse the last batch of moves. The stack itself
// lives there (undo/UndoStack.ts) - this is only a second way to pull the same
// lever the Edit > Undo menu item does, for an in-app button.
export const RequestUndo = () => {

    if (!isElectronApp) {
        return (dispatch: any) => { }
    }

    return (dispatch: any) => {
        if (ipcRender) {
            ipcRender.send('requestUndo', undefined);
        }
    }
}

// Ctrl+Z is registered as an Electron menu accelerator, which fires no matter
// where DOM focus is - including inside a text field, where it has to keep
// meaning "undo my typing". Focus handlers call this so the main process can
// stand down while an input or textarea is focused.
export const SetTextEditingActive = (active: boolean): void => {
    if (ipcRender) {
        ipcRender.send('setTextEditingActive', active);
    }
}
