import { useEffect, useRef, useState } from "react"
import { OpenDirectory, OpenDirectoryRecursive, selectMedias, updateManyArrayItem, useSelector } from "../lib/redux"
import { ImgGrid, NoMediaFound, Qtd, Resume } from "./gridImg.styled"
import { MediaIMG } from "./media"
import { Media } from "../entity/Media"
import { useDispatch } from "react-redux"
import { IconButton } from "@mui/material"
import { Folders } from "./folder"
import { KeyboardArrowLeft, KeyboardArrowRight, KeyboardDoubleArrowLeft, KeyboardDoubleArrowRight, RadioButtonChecked, RadioButtonUnchecked } from "@mui/icons-material"
import ModalZoom from "./modalZoom"
import { configurationsSelector, setPage, setPostsPerPage, setScrollPosition } from "../lib/redux/slices/configurations"
import { MediaTypeFilter, matchesMediaType } from "./mediaTypeFilter"


import { FolderCopyTwoTone, FolderOpen, Pause, PlayArrow } from '@mui/icons-material';



export const GridIMGs = (() => {


    const dispatch = useDispatch<any>();

    const config = useSelector(configurationsSelector)
    // Imported fake items (database import feature) only make sense inside
    // duplicate groups — the main grid stays a true view of the actual folder.
    const medias = useSelector(selectMedias).filter(m => !m.deleted && !m.imported)
        .filter(m => matchesMediaType(m.mime, config.mediaType))
    const currentPage = config.page;
    const setCurrentPage = (page: number) => dispatch(setPage(page));
    const postsPerPage = config.postsPerPage;
    const setPostsPerPageValue = (qty: number) => dispatch(setPostsPerPage(qty));


    const [speed, setSpeed] = useState(4);
    const [play, setPlay] = useState(true)
    const [scrollIntervalId, setScrollIntervalId] = useState<string | number | NodeJS.Timer | undefined>(undefined);

    const stepSpeed = 1500
    const inputRef = useRef<HTMLInputElement | null>(null);

    let counterIndex = 0;
    const mediaSliced = medias
        .slice(currentPage * postsPerPage, ((currentPage * postsPerPage) + postsPerPage)).map(item => {
       
            return { ...item , screenIndex : counterIndex++ }
        })



    const modalZoomRefMethods = useRef<{
        chamgeImageClass: () => void,
        fullScreenVideo: () => void,
        togleVideoControls: () => void
        playPauseVideo: () => void
        maxVolume: () => void,
        minVolume: () => void
    
      }>(null);


    const [open, setOpen] = useState(false);
    const handleOpenPreview = (media: Media) => {
        setLastZoom(media)
        setOpen(true)

    };
    const handleClose = () => setOpen(false);



    const [lastClick, setLastClick] = useState<Media>()
    const [lastZoom, setLastZoom] = useState<Media>()

    const lastClickedEvent = ($eventClick: Media) => { setLastClick($eventClick) }
    const shiftSelect = ($eventClick: Media) => { processSelection($eventClick, true) }
    const shiftControlSelect = ($eventClick: Media) => { processSelection($eventClick, false) }
    const processSelection = ($eventClick: Media, decision: boolean) => {
        let lastedId = lastClick?.screenIndex || -1
        let minor = Math.min(lastedId, $eventClick.screenIndex)
        let maxer = Math.max(lastedId, $eventClick.screenIndex)
        processChoice(
            mediaSliced.filter(photo => photo.screenIndex >= minor && photo.screenIndex <= maxer), decision
        )


        setLastClick($eventClick)
    }

    const processChoice = (mediasChoiced: Media[], decision: boolean) => {
        dispatch(updateManyArrayItem(
            mediasChoiced
                .map(photo => {

                    const media = { ...photo }
                    media.checked = decision
                    return media
                })
        ))
    }

    function selectAll(): void {

        processChoice(
            mediaSliced, true
        )
    }

    function unselectAllSelectAll(): void {

        processChoice(
            mediaSliced, false
        )
    }


    const hasRest = !((medias.length % postsPerPage) === 0)
    const qtdPages = Math.trunc(medias.length / postsPerPage)


    try {

        if (currentPage + 1 > qtdPages + (hasRest ? 1 : 0) && qtdPages > 0) {
            setCurrentPage(qtdPages - (hasRest ? 0 : 1))
        }
    } catch (error) {
        console.error(error)
    }


    useEffect(() => {
        const inputElement = inputRef.current;

        if (inputElement) {
            const handleWheel = (ev: globalThis.WheelEvent) => {
                ev.preventDefault();
                setSpeed(prev => Math.trunc((ev.deltaY * -0.01) + prev));
            };

            // Add non-passive event listener
            inputElement.addEventListener('wheel', handleWheel, { passive: false });

            return () => {
                // Clean up the event listener
                inputElement.removeEventListener('wheel', handleWheel);
            };
        }
    }, []);

    useEffect(() => {
        // Clean up the interval when the component unmounts
        return () => {
            if (scrollIntervalId) {
                clearInterval(scrollIntervalId);
            }
        };
    }, [scrollIntervalId]);

    // Restores the remembered scroll position once this page's media has
    // actually rendered - restoring any earlier would just scroll an empty page.
    const restoredScrollRef = useRef(false);
    useEffect(() => {
        if (restoredScrollRef.current) return;
        if (mediaSliced.length === 0) return;
        restoredScrollRef.current = true;
        window.scrollTo({ top: config.scrollPosition, behavior: 'auto' });
    }, [mediaSliced.length, config.scrollPosition]);

    // Debounced so scrolling doesn't spam dispatch/localStorage writes on every pixel.
    useEffect(() => {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const handleScroll = () => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                dispatch(setScrollPosition(window.scrollY));
            }, 300);
        };
        window.addEventListener('scroll', handleScroll);
        return () => {
            window.removeEventListener('scroll', handleScroll);
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [dispatch]);




    const scrollByAmount = () => {
        if (play) {

            window.scrollBy({
                top: speed * 50,
                behavior: 'smooth' // Smooth scroll behavior
            });
        }
    };

    function openDiretory() {
        dispatch(OpenDirectory())
    }

    function openDiretoryRecursive() {
        dispatch(OpenDirectoryRecursive())
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

   function nextMedia() {
            if (!lastZoom) return;
            const absIdx = medias.findIndex(m => m.id === lastZoom!.id);
            if (absIdx === -1 || absIdx >= medias.length - 1) return;
            const newIdx = absIdx + 1;
            const newPage = Math.floor(newIdx / postsPerPage);
            setCurrentPage(newPage);
            setLastZoom({ ...medias[newIdx], screenIndex: newIdx % postsPerPage });
        }
    function    prevMedia() {
            if (!lastZoom) return;
            const absIdx = medias.findIndex(m => m.id === lastZoom!.id);
            if (absIdx <= 0) return;
            const newIdx = absIdx - 1;
            const newPage = Math.floor(newIdx / postsPerPage);
            setCurrentPage(newPage);
            setLastZoom({ ...medias[newIdx], screenIndex: newIdx % postsPerPage });
        }
    

  function pressedKeyUp(ev: React.KeyboardEvent<HTMLDivElement>): any {

    if (document.querySelector('[role="dialog"]')) return;
    if (!modalZoomRefMethods.current) return;

    if (ev.key === "q" && !open ) {
      selectAll(); // Call the method in the child component
    }
    if (ev.key === "w" && !open) {
      unselectAllSelectAll(); // Call the method in the child component
    }

    if (ev.key === "s" ) {
      modalZoomRefMethods.current.playPauseVideo(); // Call the method in the child component
    }

    if (ev.key === "Escape" ) {
      setOpen(false); // Call the method in the child component
    }

    if (ev.key === "f" ) {
      modalZoomRefMethods.current.fullScreenVideo(); // Call the method in the child component
    }

    if (ev.key === "'" ) {
      modalZoomRefMethods.current.chamgeImageClass(); // Call the method in the child component
    }

    if (ev.key === "ArrowRight" && open ) {
      nextMedia();
    }
    if (ev.key === "ArrowLeft" && open ) {
      prevMedia();
    }
    if (ev.key === "1" ) {
      modalZoomRefMethods.current.togleVideoControls()
    }
    if (ev.key === "v" ) {
      modalZoomRefMethods.current.maxVolume()
    }
    if (ev.key === "b" ) {
      modalZoomRefMethods.current.minVolume()
    }
  }

    return (
        <div onKeyUp={(ev) => pressedKeyUp(ev)}>
            <Resume>
                <Qtd title="Total items not deleted">{medias.length}</Qtd>
                {config.mediaLoading && <span title="Videos are still being added one at a time in the background">Loading media…</span>}
                <select value={postsPerPage} title="How many items for page" onChange={(val) => setPostsPerPageValue(parseInt(val.currentTarget.value))}>
                    <option value="20">20</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="200">200</option>
                    <option value="500">500</option>
                    <option value="1000">1000</option>
                </select>
                <IconButton onClick={() => setCurrentPage(0)} ><KeyboardDoubleArrowLeft fontSize="small" /></IconButton>
                <IconButton onClick={() => setCurrentPage(currentPage - 1)} disabled={currentPage === 0} ><KeyboardArrowLeft fontSize="small" /></IconButton>
                <Qtd>{currentPage + 1}/{qtdPages + (hasRest ? 1 : 0)}</Qtd>
                <IconButton onClick={() => setCurrentPage(currentPage + 1)} ><KeyboardArrowRight fontSize="small" /></IconButton>
                <IconButton onClick={() => setCurrentPage(qtdPages)} ><KeyboardDoubleArrowRight fontSize="small" /></IconButton>

                <div className="spacer" />

                <IconButton className="buttonControl" onClick={() => selectAll()}><RadioButtonChecked /></IconButton>
                <IconButton className="buttonControl" onClick={() => unselectAllSelectAll()}><RadioButtonUnchecked /></IconButton>


                <Folders screenMedias={mediaSliced} />
                <div className="buttons">
                    <IconButton className="buttonControl" onClick={() => openDiretory()}><FolderOpen /></IconButton>
                    <IconButton className="buttonControl" onClick={() => openDiretoryRecursive()}><FolderCopyTwoTone /></IconButton>
                    <input type='text' value={speed} readOnly size={3} ref={inputRef} />
                    <IconButton onClick={() => playScrool()}>{play ? <PlayArrow /> : <Pause />}</IconButton>
                </div>
            </Resume>
            <ImgGrid>
                {mediaSliced.length > 0
                    ?
                    mediaSliced.map(media => <MediaIMG key={media.id} media={media}
                        lastClickedEvent={lastClickedEvent}
                        shiftSelect={shiftSelect}
                        shiftControlSelect={shiftControlSelect}
                        handleOpenPreview={handleOpenPreview}
                        isLastSeen={lastZoom?.id === media.id}
                    />)
                    : <NoMediaFound>No Media</NoMediaFound>
                }


            </ImgGrid>
            <MediaTypeFilter />

                    {lastZoom && <ModalZoom mediaWithPreview={lastZoom} handleExternalClose={handleClose} openModal={open} ref={modalZoomRefMethods}
                        onPrev={() => {
                            const absIdx = medias.findIndex(m => m.id === lastZoom.id);
                            if (absIdx <= 0) return;
                            const newIdx = absIdx - 1;
                            setCurrentPage(Math.floor(newIdx / postsPerPage));
                            setLastZoom({ ...medias[newIdx], screenIndex: newIdx % postsPerPage });
                        }}
                        onNext={() => {
                            const absIdx = medias.findIndex(m => m.id === lastZoom.id);
                            if (absIdx === -1 || absIdx >= medias.length - 1) return;
                            const newIdx = absIdx + 1;
                            setCurrentPage(Math.floor(newIdx / postsPerPage));
                            setLastZoom({ ...medias[newIdx], screenIndex: newIdx % postsPerPage });
                        }}
                    ></ModalZoom>}



        </div>)
})