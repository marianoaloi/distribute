import { useEffect, useState } from 'react';
import { IconButton } from '@mui/material';
import { GridView, Difference, Radar } from '@mui/icons-material';
import './App.css';
import { ElectronConnection, useDispatch } from './lib/redux';
import { GridIMGs } from './components/gridImg';
import { GridDuplicates } from './components/duplicatesGrid';
import { GridDetections } from './components/objectDetectionGrid';

function App() {

  const dispatch = useDispatch();
  const [view, setView] = useState<'grid' | 'duplicates' | 'detections'>('grid');

  useEffect(() => {
    dispatch(ElectronConnection())
  }, [dispatch])






  return (
    <div className="App" >

      <header className="App-header">
        {/* <img src={logo} className="App-logo" alt="logo" /> */}
        <IconButton onClick={() => setView('grid')} color={view === 'grid' ? 'primary' : 'default'} title="Grid">
          <GridView />
        </IconButton>
        <IconButton onClick={() => setView('duplicates')} color={view === 'duplicates' ? 'primary' : 'default'} title="Duplicates">
          <Difference />
        </IconButton>
        <IconButton onClick={() => setView('detections')} color={view === 'detections' ? 'primary' : 'default'} title="Object Detection">
          <Radar />
        </IconButton>
      </header>
      {view === 'grid' ? <GridIMGs /> : view === 'duplicates' ? <GridDuplicates /> : <GridDetections />}

    </div>
  );
}

export default App;

