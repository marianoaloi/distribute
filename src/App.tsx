import { useEffect, useState } from 'react';
import { IconButton } from '@mui/material';
import { GridView, Difference } from '@mui/icons-material';
import './App.css';
import { ElectronConnection, useDispatch } from './lib/redux';
import { GridIMGs } from './components/gridImg';
import { GridDuplicates } from './components/duplicatesGrid';

function App() {

  const dispatch = useDispatch();
  const [view, setView] = useState<'grid' | 'duplicates'>('grid');

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
      </header>
      {view === 'grid' ? <GridIMGs /> : <GridDuplicates />}

    </div>
  );
}

export default App;

