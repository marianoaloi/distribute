import React from "react"
import { Media } from "../entity/Media"
import { CheckBoxSelect, ImageMaloi, PreviewMedia, ThePhoto } from "./media.styled"
import { updateArrayItem, useDispatch, useSelector } from "../lib/redux"
import { configurationsSelector } from "../lib/redux/slices/configurations"

type TheMediaProps = {
    media: Media
    lastClickedEvent: any
    shiftSelect: any
    shiftControlSelect: any
    handleOpenPreview: any
}
export const MediaIMG: React.FC<TheMediaProps> = ({ media, lastClickedEvent,
    shiftSelect,
    shiftControlSelect
    , handleOpenPreview }) => {

    const dispatch = useDispatch();

    function changeCkecked(event: React.MouseEvent<HTMLImageElement, MouseEvent> | React.MouseEvent<HTMLInputElement, MouseEvent>): void {
        // media.checked = true
        const aux = { ...media }
        aux.checked = !media.checked

        if (event.shiftKey && event.ctrlKey)
            shiftControlSelect(aux)
        else if (event.shiftKey)
            shiftSelect(aux)
        else {
            lastClickedEvent(aux)
            dispatch(updateArrayItem(aux))
        }

    }

    const openPreview = () => {
        handleOpenPreview(media)
    }
    const config = useSelector(configurationsSelector)
    return <ThePhoto>
        {/* <img src={media.media} /> */}
        <ImageMaloi size={config.pxzoom} onClick={(val) => changeCkecked(val)} src={media.media} title={`${media.path}\n${prettifySizeF(media.size)}`} ></ImageMaloi>
        <CheckBoxSelect readOnly onClick={(val) => changeCkecked(val)} checked={media.checked} type="checkbox"></CheckBoxSelect>
        <PreviewMedia onClick={openPreview} isVideo={media.mime.includes('video')}>{media.mime.includes('video') ? "V" : "F"}</PreviewMedia>
    </ThePhoto>

}

export const prettifySizeF = (sizeFile: number): string => {
    if (sizeFile > 1099511627776) {
        return (sizeFile / 1099511627776).toFixed(2) + " TB";
    } else if (sizeFile > 1073741824) {
        return (sizeFile / 1073741824).toFixed(2) + " GB";
    } else if (sizeFile > 1048576) {
        return (sizeFile / 1048576).toFixed(2) + " MB";
    } else if (sizeFile > 1024) {
        return (sizeFile / 1024).toFixed(2) + " KB";
    } else if (sizeFile < 0) {
        return "-" + prettifySizeF(sizeFile * -1);
    }

    return (sizeFile).toFixed(2) + " BT";
}