import { SyntheticEvent, useRef } from "react"
import { Media } from "../entity/Media"
import { prettifySizeF } from "./media"
import { ModalBox, MediaPresentation, VideoPresentation, ImgPresentation, MediaControllersCSS, FoldersZoom } from "./modalZoom.styled"
import { IconButton, Slider } from "@mui/material"
import { toMediaUrl } from "../lib/mediaUrl"
import { CleaningServices } from "@mui/icons-material"



const ModalZoom: React.FC<{ lastZoom: Media, handleExternalClose?: any }> = ({ lastZoom: mediaWithPreview, handleExternalClose }) => {

    const imgRef = useRef<HTMLImageElement | null>(null)


    var zoonNow = 1
    function zoomImg(event: any): void {
        const imgInZoom: any = imgRef.current
        if (!imgInZoom)
            return
        zoonNow += event.deltaY > 0 ? zoonNow > 0.3 ? -0.2 : 0 : 0.2
        imgInZoom.style.zoom = (zoonNow).toString()

    }

    const filters: any = {}

    const changeFilter = () => {
        const imgInZoom: any = imgRef.current
        if (!imgInZoom)
            return
        imgInZoom.style.filter = Object.entries(filters).map(x => `${x[0]}(${x[1]})`).join(" ")
    }

    const handleChangeContrast = (event: Event, newValue: number | number[]) => {
        filters["contrast"] = newValue
        changeFilter()
    };

    const handleChangeBrightness = (event: Event, newValue: number | number[]) => {
        filters["brightness"] = newValue
        changeFilter()
    };

    const imageUnset = () => {
        const imgCurrent = imgRef.current
        if (!imgCurrent)
            return
        if (imgCurrent.classList.contains("imageAddaptScreen"))
            imgCurrent.classList.remove("imageAddaptScreen")
        else imgCurrent.classList.add("imageAddaptScreen")

    }

    function startVid(event: SyntheticEvent<HTMLVideoElement, Event>): void {
        event.currentTarget.volume = 0.1
    }

    const MediaConstPresentation = () => {
        return (
            <MediaPresentation>
                {
                    mediaWithPreview.mime.includes('video')
                        ?
                        <VideoPresentation src={toMediaUrl(mediaWithPreview.path)} onLoadStart={startVid} controls autoPlay title={`${mediaWithPreview.path}\n${prettifySizeF(mediaWithPreview.size)}`} ></VideoPresentation>
                        :
                        <ImgPresentation ref={imgRef} src={toMediaUrl(mediaWithPreview.path)} alt={mediaWithPreview.path} title={`${mediaWithPreview.path}\n${prettifySizeF(mediaWithPreview.size)}`} ></ImgPresentation>

                }
            </MediaPresentation>)
    }

    const selectMedia = (event: React.ChangeEvent<HTMLInputElement>): void => {
        mediaWithPreview.checked = !mediaWithPreview.checked
    }

    const MediaControllers = () => {
        return <MediaControllersCSS onWheel={(ev) => zoomImg(ev)}>

            <IconButton onClick={imageUnset}><CleaningServices /></IconButton>
            {mediaWithPreview.mime.includes('video') ?
                <FoldersZoom mediaOnlyCopy={mediaWithPreview} handleExternalClose={handleExternalClose} />
                :
                <>
                    <Slider
                        aria-label="Contrast"
                        defaultValue={1}
                        //   getAriaValueText={valuetext}
                        valueLabelDisplay="auto"
                        shiftStep={0.5}
                        step={0.1}
                        marks
                        min={0}
                        max={15}
                        onChange={handleChangeContrast}
                    />
                    <Slider
                        aria-label="Brightness"
                        defaultValue={1}
                        //   getAriaValueText={valuetext}
                        valueLabelDisplay="auto"
                        shiftStep={0.5}
                        step={0.1}
                        marks
                        min={0}
                        max={15}
                        onChange={handleChangeBrightness}
                    />
                </>}


        </MediaControllersCSS>
    }

    return (

        <ModalBox >
            <div>
                <input style={{ zoom: 2 }} type="checkbox"  id="selectMedia" checked={mediaWithPreview.checked} />
                <label htmlFor="selectMedia">Select</label>
                <FoldersZoom mediaOnlyCopy={mediaWithPreview} handleExternalClose={handleExternalClose} />
            </div>
            <MediaConstPresentation></MediaConstPresentation>
            <MediaControllers />
        </ModalBox>
    )

}

export default ModalZoom