import { useEffect } from 'react';
import logo from './logo.svg';
import './App.css';
import { ElectronConnection, OpenDirectory, useDispatch } from './lib/redux';
import { GridIMGs } from './components/gridImg';

function App() {

  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(ElectronConnection())
  }, [dispatch])

  function openDiretory() {
    dispatch(OpenDirectory())
  }

  return (
    <div className="App">
      <header className="App-header">
        {/* <img src={logo} className="App-logo" alt="logo" /> */}
        <div className="buttons">
          <button className="buttonControl">Select All</button>
          <button className="buttonControl">Unselect All</button>
          <button className="buttonControl" onClick={() => openDiretory()}>open</button>
          <button className="buttonControl">processPhotos</button>
        </div>
        <GridIMGs />
      </header>
    </div>
  );
}

export default App;
