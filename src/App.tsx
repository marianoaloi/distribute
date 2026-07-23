import { useEffect, useState } from 'react';
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
        <button onClick={() => setView('grid')} disabled={view === 'grid'}>Grid</button>
        <button onClick={() => setView('duplicates')} disabled={view === 'duplicates'}>Duplicates</button>
      </header>
      {view === 'grid' ? <GridIMGs /> : <GridDuplicates />}

    </div>
  );
}

export default App;

