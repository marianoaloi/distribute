import { useEffect, useRef, useState } from 'react';
import './App.css';
import { ElectronConnection, OpenDirectory, useDispatch } from './lib/redux';
import { GridIMGs } from './components/gridImg';
import { IconButton } from '@mui/material';
import { FolderOpen, Pause, PlayArrow } from '@mui/icons-material';

function App() {

  const dispatch = useDispatch();

  const [speed, setSpeed] = useState(4);
  const [play, setPlay] = useState(true)
  const [scrollIntervalId, setScrollIntervalId] = useState<string | number | NodeJS.Timer | undefined>(undefined);

  const stepSpeed = 1500
  const inputRef = useRef<HTMLInputElement | null>(null);

  const childRefMethods = useRef<{ scrollPhotos: (qtd: number) => void }>(null);

  const scrollByAmount = () => {
    if (play) {

      window.scrollBy({
        top: speed * 50,
        behavior: 'smooth' // Smooth scroll behavior
      });
    }
  };

  useEffect(() => {
    const inputElement = inputRef.current;

    if (inputElement) {
      const handleWheel = (ev: globalThis.WheelEvent) => {
        ev.preventDefault();
        setSpeed(Math.trunc((ev.deltaY * -0.01) + speed));
      };

      // Add non-passive event listener
      inputElement.addEventListener('wheel', (ev) => handleWheel(ev), { passive: false });

      return () => {
        // Clean up the event listener
        inputElement.removeEventListener('wheel', (ev) => handleWheel(ev));
      };
    }
  }, [scrollIntervalId, speed]);

  useEffect(() => {
    dispatch(ElectronConnection())
  }, [dispatch])

  function openDiretory() {
    dispatch(OpenDirectory())
  }


  function playScrool(): void {
    if (play) {

      setScrollIntervalId(setInterval(scrollByAmount, stepSpeed));
    } else {
      clearInterval(scrollIntervalId);
      setScrollIntervalId(undefined);
    }
    setPlay(!play)
  }

  useEffect(() => {
    // Clean up the interval when the component unmounts
    return () => {
      if (scrollIntervalId) {
        clearInterval(scrollIntervalId);
      }
    };
  }, [scrollIntervalId]);


  function pressedKeyDown(ev: globalThis.KeyboardEvent): any {

    if (ev.key === 's')
      playScrool()

    if (ev.key === 'a' && childRefMethods.current) {
      childRefMethods.current.scrollPhotos(-1); // Call the method in the child component
    }

    if (ev.key === 'f' && childRefMethods.current) {
      childRefMethods.current.scrollPhotos(1); // Call the method in the child component
    }

  }

  window.onkeydown = (ev) => pressedKeyDown(ev)
  return (
    <div className="App" >
      <header className="App-header">
        {/* <img src={logo} className="App-logo" alt="logo" /> */}
        <div className="buttons">
          <IconButton className="buttonControl" onClick={() => openDiretory()}><FolderOpen /></IconButton>
          <input type='text' value={speed} readOnly size={3} ref={inputRef} />
          <IconButton onClick={() => playScrool()}>{play ? <PlayArrow /> : <Pause />}</IconButton>
        </div>
      </header>
      <GridIMGs ref={childRefMethods} />
      
    </div>
  );
}

export default App;

