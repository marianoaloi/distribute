import React from "react"
import { Media } from "../entity/Media"
import { CheckBoxSelect, ImageMaloi, PreviewMedia, ThePhoto } from "./media.styled"
import { changeChecked, useDispatch } from "../lib/redux"

type TheMediaProps = {
    media: Media
}
export const MediaIMG: React.FC<TheMediaProps> = ({ media }) => {

    const dispatch = useDispatch();

    function changeCkecked(target: EventTarget): void {
        // media.checked = true
        const aux = { ...media }
        aux.checked = !media.checked
        dispatch(changeChecked(aux))

    }

    return <ThePhoto>
        {/* <img src={media.media} /> */}
        <ImageMaloi onClick={(val) => changeCkecked(val.target)} src={media.media} ></ImageMaloi>
        <CheckBoxSelect onChange={(val) => changeCkecked(val.target)} checked={media.checked} type="checkbox"></CheckBoxSelect>
        {media.mime.includes('video') ? <PreviewMedia>P</PreviewMedia> : ""}
    </ThePhoto>

}