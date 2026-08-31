import React from "react"
import { Media } from "../entity/Media"
import { CheckBoxSelect, PreviewMedia, LastSeenStar, ThePhoto } from "./media.styled"
import { CollageFrame, CollageWrap } from "./frameCollageTile.styled"
import { updateArrayItem, useDispatch, useSelector } from "../lib/redux"
import { configurationsSelector } from "../lib/redux/slices/configurations"
import { toMediaUrl } from "../lib/mediaUrl"

type FrameCollageTileProps = {
    media: Media
    frames: string[]
    lastClickedEvent: any
    shiftSelect: any
    shiftControlSelect: any
    handleOpenPreview: any
    isLastSeen?: boolean
    isOpened?: boolean
}

// Duplicates grid's thumbnail for a video/GIF whose 4 frames (start10s,
// end10s, pct50, pct10 - compareImg/videoFrames.ts) are already extracted:
// shows all 4 as one collage instead of a single flat frame, so the tile
// actually reflects the clip's content across time. Mirrors MediaIMG's
// interaction shell (checkbox, click-to-select, preview badge, zoom sizing)
// exactly - only the displayed image differs.
export const FrameCollageTile: React.FC<FrameCollageTileProps> = ({ media, frames, lastClickedEvent,
    shiftSelect,
    shiftControlSelect,
    handleOpenPreview,
    isLastSeen,
    isOpened }) => {

    const dispatch = useDispatch();
    const config = useSelector(configurationsSelector)

    function changeCkecked(event: React.MouseEvent): void {
        const aux = { ...media }
        aux.checked = !media.checked

        if (event.shiftKey && event.ctrlKey)
            shiftControlSelect(aux)
        else if (event.shiftKey)
            shiftSelect(aux)
        else if (event.ctrlKey)
            openPreview()
        else {
            lastClickedEvent(aux)
            dispatch(updateArrayItem(aux))
        }
    }

    const mouseMoveOpen = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        if (event.ctrlKey)
            openPreview()
    }

    const openPreview = () => {
        handleOpenPreview(media)
    }

    return <ThePhoto onMouseMove={mouseMoveOpen}>
        <CollageWrap size={config.pxzoom} onClick={(val) => changeCkecked(val)}
            title={`${media.path}\n${media.id} ${media.screenIndex}`}>
            {frames.map((frame, idx) => <CollageFrame size={config.pxzoom} key={idx} src={toMediaUrl(frame)} draggable={false} />)}
        </CollageWrap>
        <CheckBoxSelect readOnly onClick={(val) => changeCkecked(val)} checked={media.checked} type="checkbox"></CheckBoxSelect>
        <PreviewMedia onClick={openPreview} isGif={media.mime.includes('gif')} isVideo={media.mime.includes('video')} hasSound={media.hasAudio}>
            {media.mime.includes('gif') ? "G" : "V"}
        </PreviewMedia>
        {(isLastSeen || isOpened) && <LastSeenStar opened={!isLastSeen && isOpened}>★</LastSeenStar>}
    </ThePhoto>
}
