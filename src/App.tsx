import { useEffect, useRef } from 'react';
import './App.css';
import { ElectronConnection, useDispatch } from './lib/redux';
import { GridIMGs } from './components/gridImg';

function App() {

  const dispatch = useDispatch();





  useEffect(() => {
    dispatch(ElectronConnection())
  }, [dispatch])






  return (
    <div className="App" >

      <header className="App-header">
        {/* <img src={logo} className="App-logo" alt="logo" /> */}
      </header>
      <GridIMGs />

    </div>
  );
}

export default App;

