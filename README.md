# Distribute

An Electron + React (TypeScript) desktop app for browsing, previewing, and organizing large folders of images and videos — built for quickly triaging a media library: page through thumbnails, spot and remove duplicates, run object detection, and sort files into destination folders by moving or copying them.

## Table of Contents

- [Features](#features)
- [Keyboard Shortcuts & Mouse Controls](#keyboard-shortcuts--mouse-controls)
- [Getting Started](#getting-started)
- [Building & Packaging](#building--packaging)
- [Architecture](#architecture)

## Features

### Media Grid

- Open a folder (single level) or recursively (folder + all subfolders) and browse its images/videos/GIFs as a paginated thumbnail grid.
- Configurable page size (20 / 50 / 100 / 200 / 500 / 1000 items) and thumbnail zoom level.
- Filter the grid by media type: All, Image, Video, or GIF.
- Sort by name, size, size (inverted), or folder (via the native app menu).
- Auto-scroll ("presentation mode") with an adjustable speed, so a folder can page through itself hands-free.
- Video thumbnails are generated automatically (bundled `ffmpeg-static`), seeked to 10% into the clip, and cached on disk.
- Page size, current page, and scroll position are remembered across restarts.

### Selecting & Organizing Media

- Click to check/uncheck individual items; shift-click to check/uncheck a whole range at once.
- Maintain a list of destination folders and move or copy checked items into any of them with one click.
- **Split-move**: send checked items to one folder and unchecked items to another folder in a single action — handy for a keep/discard pass over a whole page.
- Add or remove destination folders from within the app (this only affects the app's list, it never touches the filesystem).

### Preview / Zoom Modal

- Open a large preview of any image or video, and step to the next/previous item without leaving the modal.
- Images: zoom, contrast, and brightness sliders, plus a "fit to screen" toggle and a filter-reset button.
- Videos: play/pause, fullscreen, toggle native controls, volume control, a scrub bar, and a mute indicator for silent clips.
- Check/uncheck the current item directly from the modal.

### Duplicate Finder

- Scan currently loaded media for exact duplicates (MD5 content hash).
- Scan the indexed library for *visual* (near-)duplicates using perceptual hashing.
- Auto-select the duplicates to remove within each group, always sparing one survivor (the largest copy with audio, or the largest muted one if none has sound).
- Rebuild the on-disk duplicate-detection index if it becomes corrupted.
- Export the duplicate-detection database and import another folder's export to find duplicates *across* two separate libraries.

### Object Detection

- Choose any ONNX model file and run object detection over the currently loaded media.
- Streams results back one item at a time with a progress bar; can be stopped mid-run without losing what's already been found.
- Detected boxes are drawn over each thumbnail with the class name and confidence score.

### Other

- **FixFiles mode**: when the `FixFiles` environment variable points at a file of pipe-delimited paths, the app loads exactly those files (skipping the folder picker) and logs move/copy operations to the console instead of touching disk — useful for dry runs and debugging.
- Cross-platform packaging: Windows portable executable, Linux (AppImage/deb).

## Keyboard Shortcuts & Mouse Controls

### Thumbnail Grid

| Input | Action |
|---|---|
| Click a thumbnail | Toggle checked/unchecked |
| `Shift` + Click | Check/uncheck every item between the last-clicked item and this one |
| `Shift` + `Ctrl` + Click | Same range, but unchecks instead of checks |
| `Ctrl` + Click, or `Ctrl` + hover | Open the item in the preview modal |
| Click the video/photo badge ("V"/"F") | Open the item in the preview modal |
| `q` | Select all items on the current page *(grid must be focused, modal closed)* |
| `w` | Unselect all items on the current page *(grid must be focused, modal closed)* |
| Scroll wheel over the speed box | Increase/decrease auto-scroll speed |
| Numpad `+` / Numpad `-` | Zoom the thumbnail grid in/out (also in the *Work* menu) |

### Preview Modal

| Input | Action |
|---|---|
| `Escape` | Close the modal |
| `←` / `→` | Go to the previous/next item |
| `s` | Play/pause the video |
| `f` | Toggle fullscreen for the video |
| `1` | Toggle the video's native controls |
| `v` | Set volume to maximum |
| `b` | Set volume to near-mute |
| `'` (apostrophe) | Toggle "fit image to screen" |
| Double-click the image/video | Toggle checked, then close the modal |
| Scroll wheel over the control panel | Zoom the image |
| `Ctrl` + scroll wheel over the image | Zoom the image |
| `Ctrl` + scroll wheel over the video | Adjust volume up/down |
| `Ctrl` + drag over the video | Scrub playback to the horizontal position of the cursor |
| Click `‹` / `›` | Go to the previous/next item |

### Folders Panel

| Input | Action |
|---|---|
| Click a folder button | Move (or copy, if "Only Copy" is checked) the checked media into that folder |
| Click the split-move icon | Open the split-move dialog (send checked/unchecked media to two different folders at once) |
| `Ctrl` + Click the split-move icon | Immediately run the split-move using the last-used destination folders, skipping the dialog (the icon turns gold while `Ctrl` is held to show this is available) |

## Getting Started

```bash
npm install
```

Run the renderer (React dev server) and Electron in two terminals:

```bash
npm start       # renderer, http://localhost:7845
npm run electron # Electron shell (requires a prior build, or use startele below)
```

Or use the watch workflow, which rebuilds and relaunches Electron automatically on `.ts`/`.tsx` changes:

```bash
npm run startele
```

Run tests:

```bash
npm test
```

## Building & Packaging

```bash
npm run build       # production build to build/
npm run buildMaloi   # production build with source maps
npm run buildele     # build + package for Linux
npm run winBuild      # package for Windows (portable)
npm run deb64         # create a Debian installer
```

## Architecture

- **Main process** (`app.js`): file system operations, window/menu management, directory reading, thumbnail/index/detection orchestration.
- **Renderer process** (`src/`): React app with Redux Toolkit state management.
- **Preload script** (`preload.js`): `contextBridge` with a whitelisted set of IPC channels.
- **Utilities** (`util.js`, `compareImg/`, `objectDetection/`, `thumbnails/`): media processing, duplicate detection, ONNX object detection, and thumbnail generation/caching (run in the main process).

See `CLAUDE.md` for deeper implementation notes (IPC channel list, Redux slice layout, media processing pipeline).
