import { SyntheticEvent, useRef } from "react"
import { Media } from "../entity/Media"
import { prettifySizeF } from "./media"
import { ModalBox, MediaPresentation, VideoPresentation, ImgPresentation, MediaControllersCSS, FoldersZoom } from "./modalZoom.styled"
import { Slider } from "@mui/material"



const ModalZoom: React.FC<{ lastZoom: Media, handleExternalClose?: any }> = ({ lastZoom, handleExternalClose }) => {

    const imgRef = useRef<HTMLImageElement | null>(null)


    var zoonNow = 1
    function zoomImg(event: any): void {
        const imgInZoom: any = imgRef.current
        if (!imgInZoom)
            return
        zoonNow += event.deltaY > 0 ? zoonNow > 0.3 ? -0.2 : 0 : 0.2
        imgInZoom.style.zoom = (zoonNow).toString()

    }

    const filters:any = {}

    const changeFilter = () => {
        const imgInZoom: any = imgRef.current
        if (!imgInZoom)
            return
        imgInZoom.style.filter = Object.entries(filters).map(x => `${x[0]}(${x[1]})`).join(" " )
    }

    const handleChangeContrast = (event: Event, newValue: number | number[]) => {
        filters["contrast"]=newValue
        changeFilter()
      };

      const handleChangeBrightness = (event: Event, newValue: number | number[]) => {
        filters["brightness"]=newValue
        changeFilter()
      };

    function startVid(event: SyntheticEvent<HTMLVideoElement, Event>): void {
        event.currentTarget.volume = 0.1
    }

    const MediaConstPresentation = () => {
        return (
            <MediaPresentation>
                {
                    lastZoom.mime.includes('video')
                        ?
                        <VideoPresentation src={lastZoom.path} onLoadStart={startVid} controls autoPlay title={`${lastZoom.path}\n${prettifySizeF(lastZoom.size)}`} ></VideoPresentation>
                        :
                        <ImgPresentation  ref={imgRef} src={lastZoom.path} alt={lastZoom.path} title={`${lastZoom.path}\n${prettifySizeF(lastZoom.size)}`} ></ImgPresentation>

                }
            </MediaPresentation>)
    }

    const MediaControllers = () => {
        return  <MediaControllersCSS onWheel={(ev) => zoomImg(ev)}>
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
        </MediaControllersCSS>
    }

    return (

        <ModalBox >
            <FoldersZoom  mediaOnlyCopy={lastZoom} handleExternalClose={handleExternalClose} />
            <MediaConstPresentation></MediaConstPresentation>
            <MediaControllers  />
        </ModalBox>
    )

}

export default ModalZoom