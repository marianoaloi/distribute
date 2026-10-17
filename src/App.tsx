import { useEffect, useState } from 'react';
import { IconButton } from '@mui/material';
import { GridView, Difference, Radar } from '@mui/icons-material';
import './App.css';
import { ElectronConnection, OpenDroppedFolderRecursive, selectMedias, SetTextEditingActive, useDispatch, useSelector } from './lib/redux';
import { configurationsSelector } from './lib/redux/slices/configurations';
import { GridIMGs } from './components/gridImg';
import { GridDuplicates } from './components/duplicatesGrid';
import { GridDetections } from './components/objectDetectionGrid';
import { PipelineStatus } from './components/pipelineStatus';

function App() {

  const dispatch = useDispatch();
  const [view, setView] = useState<'grid' | 'duplicates' | 'detections'>('grid');
  const [draggingFolder, setDraggingFolder] = useState(false);

  const medias = useSelector(selectMedias).filter(m => !m.deleted);
  const config = useSelector(configurationsSelector);
  // Duplicate scanning and object detection both operate on whatever the
  // grid currently has loaded — with the folder still streaming in (videos
  // load one at a time) or nothing loaded yet, there's nothing for them to
  // do, so gate access on the grid actually having finished loading items.
  const itemsReady = !config.mediaLoading && medias.length > 0;

  useEffect(() => {
    dispatch(ElectronConnection())
  }, [dispatch])

  // Bounces back to the grid if the user was on a gated page when its
  // media disappeared (folder closed) or a reload started.
  useEffect(() => {
    if (!itemsReady && view !== 'grid') setView('grid');
  }, [itemsReady, view])

  // Undo is an Electron menu accelerator (Ctrl+Z), which fires regardless of
  // where DOM focus is - so inside a text field it would undo a file move
  // instead of the user's typing. One delegated pair of focus listeners covers
  // every input in the app (the Add Folder dialog, the page-number box, any
  // future one) rather than each having to remember to opt in. focusin/focusout
  // bubble, unlike focus/blur.
  useEffect(() => {
    // Only inputs that actually hold editable text count. The grid's
    // selection checkboxes are <input> too, and they take focus on every
    // click - treating those as text entry would leave undo permanently
    // disabled after the first tile the user ticks.
    const TEXT_INPUT_TYPES = ['text', 'search', 'url', 'tel', 'email', 'password', 'number', 'folder'];
    const isTextEntry = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el || !el.tagName) return false;
      if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
      if (el.tagName !== 'INPUT') return false;
      // An <input> with no type attribute is a text field.
      const type = ((el as HTMLInputElement).getAttribute('type') || 'text').toLowerCase();
      return TEXT_INPUT_TYPES.includes(type);
    };
    const onFocusIn = (ev: FocusEvent) => { if (isTextEntry(ev.target)) SetTextEditingActive(true) };
    const onFocusOut = (ev: FocusEvent) => { if (isTextEntry(ev.target)) SetTextEditingActive(false) };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      SetTextEditingActive(false);
    };
  }, [])






  // A folder dragged in from the OS file manager is scanned recursively, like
  // "Load recursive" without the folder picker. Listeners sit on the window so
  // a drop anywhere counts - and so Electron's default (navigating the window
  // to the dropped file) never kicks in. Only OS file drags are handled; the
  // app's own images are draggable={false}.
  useEffect(() => {
    const isFileDrag = (ev: DragEvent) => !!ev.dataTransfer && Array.from(ev.dataTransfer.types).includes('Files');
    // dragenter/dragleave also fire for every child element crossed, so a
    // counter tells "left the window" apart from "moved onto a child".
    let depth = 0;
    const onDragEnter = (ev: DragEvent) => {
      if (!isFileDrag(ev)) return;
      ev.preventDefault();
      depth++;
      setDraggingFolder(true);
    };
    const onDragOver = (ev: DragEvent) => {
      if (!isFileDrag(ev)) return;
      ev.preventDefault();
      ev.dataTransfer!.dropEffect = 'copy';
    };
    const onDragLeave = (ev: DragEvent) => {
      if (!isFileDrag(ev)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDraggingFolder(false);
    };
    const onDrop = (ev: DragEvent) => {
      if (!isFileDrag(ev)) return;
      ev.preventDefault();
      depth = 0;
      setDraggingFolder(false);
      const items = Array.from(ev.dataTransfer!.items);
      const folderIndex = items.findIndex(item => item.webkitGetAsEntry()?.isDirectory);
      if (folderIndex < 0) return;
      const file = items[folderIndex].getAsFile();
      const folderPath = file && window.electron?.getPathForFile(file);
      if (folderPath) dispatch(OpenDroppedFolderRecursive(folderPath));
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [dispatch])

  return (
    <div className="App" >


      <header className="App-header">
        {/* <img src={logo} className="App-logo" alt="logo" /> */}
        <IconButton onClick={() => setView('grid')} color={view === 'grid' ? 'primary' : 'default'} title="Grid">
          <GridView />
        </IconButton>
        <IconButton onClick={() => setView('duplicates')} color={view === 'duplicates' ? 'primary' : 'default'}
          disabled={!itemsReady}
          title={itemsReady ? "Duplicates" : "Load media in the grid first"}>
          <Difference />
        </IconButton>
        <IconButton onClick={() => setView('detections')} color={view === 'detections' ? 'primary' : 'default'}
          disabled={!itemsReady}
          title={itemsReady ? "Object Detection" : "Load media in the grid first"}>
          <Radar />
        </IconButton>
      </header>
      {view === 'grid' ? <GridIMGs /> : view === 'duplicates' ? <GridDuplicates /> : <GridDetections />}

      <PipelineStatus />

      {draggingFolder && <div className="App-dropOverlay">Drop a folder to load it recursively</div>}
    </div>
  );
}

export default App;

