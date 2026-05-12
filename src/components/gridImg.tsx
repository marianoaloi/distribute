import { forwardRef, SyntheticEvent, useEffect, useImperativeHandle, useRef, useState } from "react"
import { OpenDirectory, OpenDirectoryRecursive, selectMedias, updateManyArrayItem, useSelector } from "../lib/redux"
import { FilterBar, ImgGrid, Qtd, Resume } from "./gridImg.styled"
import { MediaIMG, prettifySizeF } from "./media"
import { Media } from "../entity/Media"
import { useDispatch } from "react-redux"
import { IconButton, Modal } from "@mui/material"
import { Folders } from "./folder"
import { Filter, KeyboardArrowLeft, KeyboardArrowRight, KeyboardDoubleArrowLeft, KeyboardDoubleArrowRight, RadioButtonChecked, RadioButtonUnchecked } from "@mui/icons-material"
import ModalZoom from "./modalZoom"
import { configurationsSelector, setMediaType } from "../lib/redux/slices/configurations"


import { FolderCopyTwoTone, FolderOpen, Pause, PlayArrow } from '@mui/icons-material';

interface GridMethods {
    nextMedia: () => void,
    prevMedia: () => void
}

export const GridIMGs = forwardRef<GridMethods>((props, ref) => {


    const dispatch = useDispatch<any>();

    const config = useSelector(configurationsSelector)
    const medias = useSelector(selectMedias).filter(m => !m.deleted)
        .filter(m => !config.mediaType ? true : m.mime.includes(config.mediaType))
    const [currentPage, setCurrentPage] = useState(0);
    const [postsPerPage, setPostsPerPage] = useState(50);


    const [speed, setSpeed] = useState(4);
    const [play, setPlay] = useState(true)
    const [scrollIntervalId, setScrollIntervalId] = useState<string | number | NodeJS.Timer | undefined>(undefined);

    const stepSpeed = 1500
    const inputRef = useRef<HTMLInputElement | null>(null);

    let counterIndex = 0;
    const mediaSliced = medias
        .slice(currentPage * postsPerPage, ((currentPage * postsPerPage) + postsPerPage)).map(item => {
            const mitem = { ...item }
            mitem.screenIndex = counterIndex++
            return mitem
        })


    // Expose methods to parent using useImperativeHandle
    useImperativeHandle(ref, () => ({
        scrollPhotos(qtd: number) {
            if (qtd < 0 && currentPage !== 0)
                setCurrentPage(currentPage - 1)
            else if (qtd > 0 && currentPage < qtdPages)
                setCurrentPage(currentPage + 1);
            else
                setCurrentPage(0)
        },
        closePreview() {
            setOpen(false)
        },
        selectAll() { selectAll() },
        unselectAllSelectAll() { unselectAllSelectAll() },
        chamgeImageClass: () => modalZoomRefMethods.current?.chamgeImageClass(),
        fullScreenVideo: () => modalZoomRefMethods.current?.fullScreenVideo(),
        nextMedia() {
            if (!lastZoom) return;
            const absIdx = medias.findIndex(m => m.id === lastZoom!.id);
            if (absIdx === -1 || absIdx >= medias.length - 1) return;
            const newIdx = absIdx + 1;
            const newPage = Math.floor(newIdx / postsPerPage);
            setCurrentPage(newPage);
            setLastZoom({ ...medias[newIdx], screenIndex: newIdx % postsPerPage });
        },
        prevMedia() {
            if (!lastZoom) return;
            const absIdx = medias.findIndex(m => m.id === lastZoom!.id);
            if (absIdx <= 0) return;
            const newIdx = absIdx - 1;
            const newPage = Math.floor(newIdx / postsPerPage);
            setCurrentPage(newPage);
            setLastZoom({ ...medias[newIdx], screenIndex: newIdx % postsPerPage });
        }
    }));

    const modalZoomRefMethods = useRef<{
        chamgeImageClass: () => void,
        fullScreenVideo: () => void
    
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
        // Clean up the interval when the component unmounts
        return () => {
            if (scrollIntervalId) {
                clearInterval(scrollIntervalId);
            }
        };
    }, [scrollIntervalId]);

    const FilterComponent = () => {
        return <FilterBar>
            <IconButton onClick={() => dispatch(setMediaType(config.mediaType === "video" ? "image" : !config.mediaType ? "video" : undefined))} color={config.mediaType === "video" ? "primary" : !config.mediaType ? "secondary" : "default"}><Filter /></IconButton>
        </FilterBar>
    }


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

    return (
        <>
            <Resume>
                <Qtd title="Total items not deleted">{medias.length}</Qtd>
                <select value={postsPerPage} title="How many items for page" onChange={(val) => setPostsPerPage(parseInt(val.currentTarget.value))}>
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


                <IconButton className="buttonControl" onClick={() => selectAll()}><RadioButtonChecked /></IconButton>
                <IconButton className="buttonControl" onClick={() => unselectAllSelectAll()}><RadioButtonUnchecked /></IconButton>

                <Folders />
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
                    mediaSliced.map(media => <MediaIMG key={`${media.screenIndex}${media.id}`} media={media}
                        lastClickedEvent={lastClickedEvent}
                        shiftSelect={shiftSelect}
                        shiftControlSelect={shiftControlSelect}
                        handleOpenPreview={handleOpenPreview}
                    />)
                    : <h1>No Media</h1>
                }


            </ImgGrid>
            <FilterComponent />

 {lastZoom ?

                    <ModalZoom mediaWithPreview={lastZoom} handleExternalClose={handleClose} openModal={open} ref={modalZoomRefMethods}
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
                    ></ModalZoom>


                    : <p>No Media found</p>}

        </>)
})