import { useEffect, useState } from 'react';
import { IconButton } from '@mui/material';
import { GridView, Difference, Radar } from '@mui/icons-material';
import './App.css';
import { ElectronConnection, selectMedias, useDispatch, useSelector } from './lib/redux';
import { configurationsSelector } from './lib/redux/slices/configurations';
import { GridIMGs } from './components/gridImg';
import { GridDuplicates } from './components/duplicatesGrid';
import { GridDetections } from './components/objectDetectionGrid';

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

    </div>
  );
}

export default App;

