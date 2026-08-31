import { useEffect, useState } from 'react';
import { IconButton } from '@mui/material';
import { GridView, Difference, Radar } from '@mui/icons-material';
import './App.css';
import { ElectronConnection, selectMedias, SetTextEditingActive, useDispatch, useSelector } from './lib/redux';
import { configurationsSelector } from './lib/redux/slices/configurations';
import { GridIMGs } from './components/gridImg';
import { GridDuplicates } from './components/duplicatesGrid';
import { GridDetections } from './components/objectDetectionGrid';
import { PipelineStatus } from './components/pipelineStatus';

function App() {

  const dispatch = useDispatch();
  const [view, setView] = useState<'grid' | 'duplicates' | 'detections'>('grid');

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
    </div>
  );
}

export default App;

