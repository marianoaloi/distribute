import { createAction } from "@reduxjs/toolkit";


export const addFolder = createAction<string>(
    'folder/add'
)

export const removeFolder = createAction<string>(
    'folder/remove'
)

// Work > Reload folders: back to only the default buttons, before the tmp
// folder's destinations are added again (menuOpen).
export const resetFolders = createAction(
    'folder/reset'
)

// Remembers the split-move dialog's last picked destinations, so repeating
// the same checked/unchecked-to-folder strategy doesn't require re-picking
// every time.
export const setSplitMoveUncheckedFolder = createAction<string>(
    'folder/setSplitMoveUncheckedFolder'
)

export const setSplitMoveCheckedFolder = createAction<string>(
    'folder/setSplitMoveCheckedFolder'
)