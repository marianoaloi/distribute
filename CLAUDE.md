# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Electron-based media browser for viewing and organizing images/videos. Loads media from directories, displays in a paginated grid, and allows moving/copying files to subfolders. Built with React + TypeScript (renderer) and Node.js (main process).

## Development Commands

```bash
# React dev server (renderer)
npm start                 # Starts on localhost:3000 (BROWSER=none to skip auto-open)
npm run build             # Production build to build/
npm run buildMaloi        # Build with source maps

# Electron
npm run electron          # Launch Electron (requires prior build)
npm run startele          # Watch mode: nodemon rebuilds on .ts/.tsx changes, then launches Electron

# Full workflow: npm run build && npm run electron
# Dev workflow:  terminal 1: npm start | terminal 2: npm run electron

# Tests
npm test                  # Jest in watch mode (react-scripts test)

# Packaging
npm run buildele          # Build React + package for Linux
npm run winBuild          # Package for Windows
npm run deb64             # Create Debian installer
```

## Architecture

### Process Architecture

- **Main Process** (`app.js`): File system ops, window management, native menus, directory reading
- **Renderer Process** (`src/`): React app with Redux state management
- **Preload Script** (`preload.js`): `contextBridge` with whitelisted IPC channels
- **Utilities** (`util.js`): Media file processing, sorting, video thumbnail generation (runs in main process)

### IPC Communication

All IPC goes through `preload.js` channel whitelist. Components never call IPC directly — they dispatch Redux actions or call helper functions in `electron.action.ts` which wrap `window.electron.ipcRenderer.send()`.

Key channels: `open`, `openRecursive`, `directoryOpen`, `loadMedias`, `process`, `zoom`, `menuOpen`, `sort`, `verifyOpen`

To add a new IPC channel: add it to all three arrays (`send`, `receive`, `sendReceive`) in `preload.js`, handle it in `app.js` with `ipcMain.on()`, and call it from `electron.action.ts`.

### Redux State (RTK)

Three slices in `src/lib/redux/slices/`:

1. **media** — Uses `createSlice`. Core media array, selection state, sorting. Key reducers: `populateArray`, `addListinActualArray`, `updateArrayItem`, `updateManyArrayItem`
2. **folders** — Uses `createReducer` + `createAction`. Destination folder list for file organization
3. **configurations** — Uses `createReducer` + `createAction`. Zoom level, media type filter, scroll speed

Note: `configurations` is NOT re-exported from `slices/index.ts` — import directly from `slices/configurations`.

Store setup in `src/lib/redux/store.ts` uses `redux-logger` middleware in development.

### Styling

- **Emotion** (`@emotion/styled`) for custom styled components
- **MUI v6** (`@mui/material`, `@mui/icons-material`) for UI primitives
- Each component has a companion `.styled.tsx` file (e.g., `gridImg.styled.tsx`)

### Component Patterns

- **GridIMGs** uses `forwardRef` + `useImperativeHandle` to expose `scrollPhotos()` to parent (`App.tsx`)
- **App.tsx** handles global keyboard events and delegates to GridIMGs via ref
- Media type filtering in GridIMGs: `config.mediaType` filters to "video", "image", or all

### Media Processing Pipeline (`util.js`)

1. `transformData(files, folderPath, counter, sortFn)` → filters to image/video by mime-type → sorts → generates video thumbnails
2. Video thumbnails use `ffmpegthumbnailer` CLI tool, cached by MD5 hash of filepath
3. Thumbnail cache location: `C:\tmp\ffmpeg\` (hardcoded Windows path — will break on Linux)
4. Sorting functions: `sortSize` (default), `sortName`, `sortFolder`, `noSort`

### Cross-Platform Considerations

- `app.js` creates temp dir at `path.join(__dirname, "tmp")` but `util.js` hardcodes `C:\tmp\ffmpeg\` for thumbnail cache — these are inconsistent
- `ffmpegthumbnailer` must be installed and on PATH for video thumbnail generation
- Dev mode detection uses `electron-is-dev` package; in dev loads `localhost:3000`, in prod loads `build/index.html`
- On Windows, `app.on("window-all-closed")` calls `process.exit(0)` instead of `app.quit()`

### Keyboard Shortcuts (handled in App.tsx)

- `s` — Toggle auto-scroll
- `a` — Previous page
- `f` — Next page
- Mouse wheel on speed input — Adjust scroll speed
- `numpad +/-` — Zoom in/out (via menu accelerators in app.js)

### FixFiles Mode

If `process.env.FixFiles` points to a file containing pipe-delimited (`|`) paths, the app loads those specific files instead of showing a directory picker. In this mode, the `process` IPC handler logs move operations to console instead of actually moving files.
