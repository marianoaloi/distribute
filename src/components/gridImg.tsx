import { useEffect, useRef, useState } from "react"
import { OpenDirectory, OpenDirectoryRecursive, selectMedias, updateManyArrayItem, useSelector } from "../lib/redux"
import { FilterBar, ImgGrid, Qtd, Resume } from "./gridImg.styled"
import { MediaIMG } from "./media"
import { Media } from "../entity/Media"
import { useDispatch } from "react-redux"
import { IconButton, Menu, MenuItem, ListItemIcon, ListItemText } from "@mui/material"
import { Folders } from "./folder"
import { KeyboardArrowLeft, KeyboardArrowRight, KeyboardDoubleArrowLeft, KeyboardDoubleArrowRight, RadioButtonChecked, RadioButtonUnchecked, Gif, Movie, Image, AllInclusive } from "@mui/icons-material"
import ModalZoom from "./modalZoom"
import { configurationsSelector, setMediaType, setPage } from "../lib/redux/slices/configurations"


import { FolderCopyTwoTone, FolderOpen, Pause, PlayArrow } from '@mui/icons-material';



export const GridIMGs = (() => {


    const dispatch = useDispatch<any>();

    const config = useSelector(configurationsSelector)
    const medias = useSelector(selectMedias).filter(m => !m.deleted)
        .filter(m => {
            if (!config.mediaType) return true;
            if (config.mediaType === "gif") return m.mime.includes("gif");
            if (config.mediaType === "video") return m.mime.includes("video");
            if (config.mediaType === "image") return m.mime.includes("image") && !m.mime.includes("gif");
            return true;
        })
    const currentPage = config.page;
    const setCurrentPage = (page: number) => dispatch(setPage(page));
    const [postsPerPage, setPostsPerPage] = useState(50);


    const [speed, setSpeed] = useState(4);
    const [play, setPlay] = useState(true)
    const [scrollIntervalId, setScrollIntervalId] = useState<string | number | NodeJS.Timer | undefined>(undefined);

    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const openMenu = Boolean(anchorEl);

    const handleClickFilter = (event: React.MouseEvent<HTMLButtonElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleCloseMenu = () => {
        setAnchorEl(null);
    };

    const handleSelectMediaType = (type: 'video' | 'image' | 'gif' | undefined) => {
        dispatch(setMediaType(type));
        handleCloseMenu();
    };

    const getFilterIcon = () => {
        switch (config.mediaType) {
            case 'gif':
                return <Gif fontSize="medium" />;
            case 'video':
                return <Movie fontSize="medium" />;
            case 'image':
                return <Image fontSize="medium" />;
            default:
                return <AllInclusive fontSize="medium" />;
        }
    };

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

                <div className="spacer" />

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
                    mediaSliced.map(media => <MediaIMG key={media.id} media={media}
                        lastClickedEvent={lastClickedEvent}
                        shiftSelect={shiftSelect}
                        shiftControlSelect={shiftControlSelect}
                        handleOpenPreview={handleOpenPreview}
                    />)
                    : <h1>No Media</h1>
                }


            </ImgGrid>
            <FilterBar>
                <IconButton 
                    onClick={handleClickFilter} 
                    color={config.mediaType ? "primary" : "default"}
                    title={`Filter: ${config.mediaType || 'All'}`}
                >
                    {getFilterIcon()}
                </IconButton>
            </FilterBar>
            <Menu
                anchorEl={anchorEl}
                open={openMenu}
                onClose={handleCloseMenu}
                anchorOrigin={{
                    vertical: 'top',
                    horizontal: 'left',
                }}
                transformOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                }}
                slotProps={{
                    paper: {
                        sx: {
                            background: '#1e222b',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: '#fff',
                            '& .MuiMenuItem-root': {
                                gap: '10px',
                                padding: '8px 16px',
                                '&:hover': {
                                    background: 'rgba(255, 255, 255, 0.08)',
                                },
                                '&.Mui-selected': {
                                    background: 'rgba(25, 118, 210, 0.3)',
                                    '&:hover': {
                                        background: 'rgba(25, 118, 210, 0.4)',
                                        }
                                    }
                                }
                            }
                        }
                    }}
                >
                <MenuItem selected={config.mediaType === undefined} onClick={() => handleSelectMediaType(undefined)}>
                    <ListItemIcon><AllInclusive style={{ color: '#fff' }} /></ListItemIcon>
                    <ListItemText>All</ListItemText>
                </MenuItem>
                <MenuItem selected={config.mediaType === 'gif'} onClick={() => handleSelectMediaType('gif')}>
                    <ListItemIcon><Gif style={{ color: '#fff' }} /></ListItemIcon>
                    <ListItemText>GIF</ListItemText>
                </MenuItem>
                <MenuItem selected={config.mediaType === 'video'} onClick={() => handleSelectMediaType('video')}>
                    <ListItemIcon><Movie style={{ color: '#fff' }} /></ListItemIcon>
                    <ListItemText>Video</ListItemText>
                </MenuItem>
                <MenuItem selected={config.mediaType === 'image'} onClick={() => handleSelectMediaType('image')}>
                    <ListItemIcon><Image style={{ color: '#fff' }} /></ListItemIcon>
                    <ListItemText>Image</ListItemText>
                </MenuItem>
            </Menu>

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

        </div>)
})