# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Electron-based media browser application for viewing and organizing images and videos. The app loads media files from directories, displays them in a paginated grid, and allows users to move/copy files to subfolders for organization. Built with React + TypeScript (renderer) and Node.js (main process).

## Development Commands

### React Development
```bash
npm start                 # Start React dev server (BROWSER=none to skip auto-open)
npm run build            # Production build of React app to build/
npm run buildMaloi       # Build with source maps
npm test                 # Run tests in watch mode
```

### Electron Development
```bash
npm run electron         # Launch Electron app (requires prior build)
npm run startele         # Watch mode: auto-rebuild on .ts/.tsx changes
```

### Packaging
```bash
npm run buildele         # Build React app and package for Linux
./ExecutableLinux.sh     # Package Electron app for Linux (disables DevTools)
npm run deb64           # Create Debian installer from packaged app
npm run winBuild        # Package for Windows (requires winBuild.js)
```

## Architecture

### Electron Process Architecture

The app follows standard Electron architecture with main and renderer processes:

- **Main Process** ([app.js](app.js)): Handles file system operations, window management, and native menus
- **Renderer Process** (React app in [src/](src/)): UI and user interactions
- **Preload Script** ([preload.js](preload.js)): Securely exposes IPC channels via `contextBridge`

### IPC Communication Pattern

IPC communication flows through a whitelisted channel system in preload.js:

1. **Renderer → Main**: `window.electron.ipcRenderer.send(channel, args)`
2. **Main → Renderer**: `mainWindow.webContents.send(channel, data)`
3. **Bidirectional handlers** defined in [src/lib/redux/slices/media/electron.action.ts](src/lib/redux/slices/media/electron.action.ts)

Key IPC channels:
- `open` / `openRecursive`: Trigger folder selection dialogs
- `directoryOpen` / `loadMedias`: Main sends file data to renderer
- `process`: Renderer sends move/copy instructions to main
- `zoom`: Main triggers zoom level changes
- `menuOpen`: Main sends folder list for organizing files
- `sort`: Main triggers re-sorting of media files

### Redux State Management

State is organized into three slices ([src/lib/redux/slices/](src/lib/redux/slices/)):

1. **media** ([slices/media/](src/lib/redux/slices/media/)): Core media file data and operations
   - `populateArray`: Replaces all media items (initial load)
   - `addListinActualArray`: Appends media items (recursive load)
   - `updateArrayItem` / `updateManyArrayItem`: Toggle checked state or mark deleted
   - Sorting actions: `orderByName`, `orderBySize`, `orderByFolder`

2. **folders** ([slices/folders/](src/lib/redux/slices/folders/)): Available destination folders for organization

3. **configurations** ([slices/configurations/](src/lib/redux/slices/configurations/)): UI settings like zoom level

### Media Processing Pipeline

File processing happens in [util.js](util.js):

1. **transformData()**: Converts file paths to Media objects
   - Filters to only image/video files (using mime-types)
   - Generates video thumbnails using `ffmpegthumbnailer` (cached in /tmp/)
   - Sorts by size/name/folder
   - Assigns sequential IDs

2. **Main process** reads directories and passes file lists to util.js
3. **Renderer** receives Media objects via IPC and stores in Redux
4. **Grid component** ([src/components/gridImg.tsx](src/components/gridImg.tsx)) paginates and renders

### Key UI Components

- **GridIMGs** ([src/components/gridImg.tsx](src/components/gridImg.tsx)): Main grid with pagination, selection, and organization UI
  - Selection modes: single click, shift-click for ranges, shift+ctrl for non-contiguous
  - Exposes `scrollPhotos()` method to parent for keyboard navigation

- **MediaIMG** ([src/components/media.tsx](src/components/media.tsx)): Individual media item with thumbnail, checkbox, and metadata

- **Folders** ([src/components/folder.tsx](src/components/folder.tsx)): Destination folder buttons for moving/copying files

- **ModalZoom** ([src/components/modalZoom.tsx](src/components/modalZoom.tsx)): Full-size media preview

### File Organization Flow

1. User clicks folder button in Folders component
2. Component dispatches `SendSelectedFiles()` thunk ([electron.action.ts:96](src/lib/redux/slices/media/electron.action.ts#L96))
3. IPC sends selected media + destination to main process via `process` channel
4. Main process ([app.js:157](app.js#L157)) moves or copies files to subfolder
5. Files are removed from view (or marked for tracking)

### Special Features

- **Recursive Loading**: Menu → "Load recursive" scans nested folders and incrementally loads media
- **Auto-scrolling**: 's' key toggles smooth auto-scroll; mouse wheel over speed input adjusts rate
- **Keyboard Navigation**: 'a'/'f' keys for previous/next page
- **Video Thumbnail Generation**: Uses ffmpegthumbnailer (requires Linux installation)
- **FixFiles Mode**: If `process.env.FixFiles` exists and points to a pipe-delimited file list, app loads those specific files instead of directory browsing

### Menu System

Application menu defined in [app.js:8](app.js#L8):
- **File**: Load recursive
- **View**: Reload, Force Reload, Toggle DevTools
- **Work**: Load folders, Zoom In/Out (numpad +/-)
- **Order**: Sort by Name/Size/Folder

### TypeScript Configuration

- Target: ES5 for broad compatibility
- Strict mode enabled
- React JSX transform
- Source files limited to [src/](src/) directory only
