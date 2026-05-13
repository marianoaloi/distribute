import { useEffect, useRef } from 'react';
import './App.css';
import { ElectronConnection, useDispatch } from './lib/redux';
import { GridIMGs } from './components/gridImg';

function App() {

  const dispatch = useDispatch();



  const childRefMethods = useRef<{
    scrollPhotos: (qtd: number) => void,
    closePreview: () => void,
    selectAll: () => void,
    unselectAllSelectAll: () => void,
    chamgeImageClass: () => void,
    fullScreenVideo: () => void,
    nextMedia: () => void,
    prevMedia: () => void

  }>(null);


  useEffect(() => {
    dispatch(ElectronConnection())
  }, [dispatch])






  function pressedKeyUp(ev: globalThis.KeyboardEvent): any {

    if (document.querySelector('[role="dialog"]')) return;

    if (ev.key === "q" && childRefMethods.current) {
      childRefMethods.current.selectAll(); // Call the method in the child component
    }
    if (ev.key === "w" && childRefMethods.current) {
      childRefMethods.current.unselectAllSelectAll(); // Call the method in the child component
    }

    if (ev.key === "Escape" && childRefMethods.current) {
      childRefMethods.current.closePreview(); // Call the method in the child component
    }

    if (ev.key === "f" && childRefMethods.current) {
      childRefMethods.current.fullScreenVideo(); // Call the method in the child component
    }

    if (ev.key === "'" && childRefMethods.current) {
      childRefMethods.current.chamgeImageClass(); // Call the method in the child component
    }

    if (ev.key === "ArrowRight" && childRefMethods.current) {
      childRefMethods.current.nextMedia();
    }
    if (ev.key === "ArrowLeft" && childRefMethods.current) {
      childRefMethods.current.prevMedia();
    }
  }

  // window.onkeydown = (ev) => pressedKeyDown(ev)
  window.addEventListener('keyup', (ev) => pressedKeyUp(ev), true);
  return (
    <div className="App" >

      <header className="App-header">
        {/* <img src={logo} className="App-logo" alt="logo" /> */}
      </header>
      <GridIMGs ref={childRefMethods} />

    </div>
  );
}

export default App;

