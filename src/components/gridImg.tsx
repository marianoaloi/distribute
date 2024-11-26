import { forwardRef, SyntheticEvent, useImperativeHandle, useState } from "react"
import { selectMedias, updateManyArrayItem, useSelector } from "../lib/redux"
import { ImgGrid, ModalBox, Qtd, Resume } from "./gridImg.styled"
import { MediaIMG, prettifySizeF } from "./media"
import { Media } from "../entity/Media"
import { useDispatch } from "react-redux"
import { IconButton, Modal } from "@mui/material"
import { Folders } from "./folder"
import { KeyboardArrowLeft, KeyboardArrowRight, KeyboardDoubleArrowLeft, KeyboardDoubleArrowRight, RadioButtonChecked, RadioButtonUnchecked } from "@mui/icons-material"

interface GridMethods {
    scrollPhotos: (qtd: number) => void
}

export const GridIMGs = forwardRef<GridMethods>((props, ref) => {


    const dispatch = useDispatch();

    const medias = useSelector(selectMedias).filter(m => !m.deleted)
    const [currentPage, setCurrentPage] = useState(0);
    const [postsPerPage, setPostsPerPage] = useState(50);

    let counterIndex = 0;
    const mediaSliced = medias.slice(currentPage * postsPerPage, ((currentPage * postsPerPage) + postsPerPage)).map(item => {
        const mitem = {...item}
        mitem.screenIndex = counterIndex++
    return mitem})
    

    // Expose methods to parent using useImperativeHandle
    useImperativeHandle(ref, () => ({
        scrollPhotos(qtd: number) {
            if (qtd < 0 && currentPage !== 0)
                setCurrentPage(currentPage - 1)
            else if (qtd > 0 && currentPage < qtdPages)
                setCurrentPage(currentPage + 1);
            else
                setCurrentPage(0)
        }
    }));


    const [open, setOpen] = useState(false);
    const handleOpenPreview = (media: Media) => {
        setLastClick(media)
        setOpen(true)

    };
    const handleClose = () => setOpen(false);



    const [lastClick, setLastClick] = useState<Media>()
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

    function startVid(event: SyntheticEvent<HTMLVideoElement, Event>): void {
        event.currentTarget.volume = 0.1
    }
    const hasRest = !((medias.length % postsPerPage) === 0)
    const qtdPages = Math.trunc(medias.length / postsPerPage)


    try {
        
        if(currentPage+1 > qtdPages + (hasRest ? 1 : 0) && qtdPages > 0){            
            setCurrentPage(qtdPages - (hasRest ? 0 : 1))
        }
    } catch (error) {
        console.error(error)
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
                <div>
                <Folders />
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


            <Modal
                open={open}
                onClose={handleClose}
                aria-labelledby="modal-modal-title"
                aria-describedby="modal-modal-description"
            >
                <ModalBox >
                    <Folders mediaOnlyCopy={lastClick} handleExternalClose={handleClose} />
                    {lastClick ?
                        (
                            lastClick.mime.includes('video')
                                ?
                                <video src={lastClick.media} onLoadStart={startVid} controls autoPlay title={`${lastClick.path}\n${prettifySizeF(lastClick.size)}`} />
                                :
                                <img src={lastClick.media} alt={lastClick.path} title={`${lastClick.path}\n${prettifySizeF(lastClick.size)}`} />

                        )

                        : <p>No Media found</p>}
                </ModalBox>
            </Modal>


        </>)
})