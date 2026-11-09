import { forwardRef, SyntheticEvent, useEffect, useImperativeHandle, useRef, useState } from "react"
import { Media } from "../entity/Media"
import { prettifySizeF } from "./media"
import { ModalBox, MediaPresentation, VideoPresentation, ImgPresentation, ImgWrapper, MediaControllersCSS, FoldersZoom, MuteIcon, InfoBox, ZoomHeader, VideoProgress, FramesPanel, FrameTile } from "./modalZoom.styled"
import { IconButton, Slider, Modal } from "@mui/material"
import { toMediaUrl } from "../lib/mediaUrl"
import { ArrowBackIos, ArrowForwardIos, CleaningServices, Label, ContentCopy, Check, Image } from "@mui/icons-material"
import { updateArrayItem, useDispatch, useSelector, selectDetections, selectMediaFrames, selectMediaFrameBoxes, GetMediaFrames } from "../lib/redux"
import { configurationsSelector, setVideoVolume } from "../lib/redux/slices/configurations"
import { DetectionBoxOutline, DetectionBoxLabel } from "./objectDetectionGrid.styled"

interface ModalZoomMethods {
    chamgeImageClass: () => void,
    fullScreenVideo: () => void,
    togleVideoControls: () => void
    playPauseVideo: () => void
}

interface ModalZoomProps {
    mediaWithPreview: Media,
    handleExternalClose?: any,
    openModal?: boolean,
    onNext?: () => void,
    onPrev?: () => void
}

// Volume levels the +/- keys and Shift+wheel step through, 0.1% to 100%:
// 0.1% steps up to 1%, 1% steps up to 10%, 5% steps up to 100%.
// Built from integers so every level is exact (no 0.05-step float drift).
const VOLUME_LEVELS: number[] = [
    ...Array.from({ length: 10 }, (_, i) => (i + 1) / 1000),    // 0.1% .. 1%
    ...Array.from({ length: 9 }, (_, i) => (i + 2) / 100),      // 2% .. 10%
    ...Array.from({ length: 18 }, (_, i) => (i + 3) * 5 / 100), // 15% .. 100%
]

// Next level strictly above / below the current volume, so a volume set
// off-grid (native slider drag, a persisted value) snaps onto the grid.
const nextVolumeLevel = (volume: number, direction: 1 | -1): number => {
    const eps = 1e-6
    return direction > 0
        ? VOLUME_LEVELS.find(level => level > volume + eps) ?? VOLUME_LEVELS[VOLUME_LEVELS.length - 1]
        : VOLUME_LEVELS.filter(level => level < volume - eps).pop() ?? VOLUME_LEVELS[0]
}

const ModalZoom = forwardRef<ModalZoomMethods, ModalZoomProps>(
    ({ mediaWithPreview, handleExternalClose, openModal, onNext, onPrev }, ref) => {

        const imgRef = useRef<HTMLImageElement | null>(null)
        const divImgRef = useRef<HTMLDivElement | null>(null)
        const videoRef = useRef<HTMLVideoElement | null>(null)
        const dispatch = useDispatch();
        const config = useSelector(configurationsSelector)
        const detections = useSelector(selectDetections)
        const detectedObjects = detections[mediaWithPreview.id]?.boxes || []
        const [volumeLevel, setVolumeLevel] = useState(0);
        const [currentTime, setCurrentTime] = useState(0);
        const [duration, setDuration] = useState(0);
        const [showDetections, setShowDetections] = useState(false);
        const toggleDetections = () => setShowDetections(v => !v)
        // Video/GIF detection runs on the 4 extracted frames (start10s, end10s,
        // pct50, pct10 - compareImg/videoFrames.ts). This shows them in a column
        // beside the media, each overlaid with the boxes detected on that frame.
        const isAnimated = mediaWithPreview.mime.includes('video') || mediaWithPreview.mime.includes('gif')
        const mediaFrames = useSelector(selectMediaFrames)
        const frames = mediaFrames[mediaWithPreview.id] || []
        const frameBoxes = useSelector(selectMediaFrameBoxes)[mediaWithPreview.id] || {}
        // Frame files are named <hash>_<position>.jpg (videoFrames.ts's framePathFor).
        // end10s falls back to the media's display boxes for results streamed
        // by a detection run after the frames were fetched.
        const boxesForFrame = (frame: string) => {
            const position = /_([^_]+)\.jpg$/.exec(frame)?.[1] || ''
            return frameBoxes[position] || (position === 'end10s' ? detectedObjects : [])
        }
        const [showDetectionFrames, setShowDetectionFrames] = useState(false)
        const showFramesPanel = showDetectionFrames && isAnimated
        useEffect(() => {
            if (showFramesPanel) dispatch(GetMediaFrames([mediaWithPreview]) as any)
        }, [showFramesPanel, mediaWithPreview.id, dispatch])
        const [pathCopied, setPathCopied] = useState(false)
        // Scale factor for the video, applied as a transform (origin top-left)
        // so MediaPresentation's overflow:auto scrolls over the enlarged frame.
        // Reset per media so the next video doesn't open already zoomed in.
        const [videoZoom, setVideoZoom] = useState(1)
        // CSS zoom of the image, held in state (not a render-local variable)
        // so Ctrl+wheel and the Zoom slider move the same value and a re-render
        // never snaps it back to 1. Same per-media reset as videoZoom.
        const [imageZoom, setImageZoom] = useState(1)
        useEffect(() => { setVideoZoom(1); setImageZoom(1) }, [mediaWithPreview.id])

        // Floor of 0.001 (0.1%) rather than 0, same as minVolume: a 0 would be
        // persisted (saveVideoVolume) and open every next video silent.
        const stepVolume = (direction: 1 | -1): void => {
            const video = videoRef.current
            if (!video) return
            video.volume = nextVolumeLevel(video.volume, direction)
        }

        // Main-row + / - step a zoomed video's volume. The numpad +/- (same
        // ev.key, told apart by ev.code) and Ctrl+'+' / Ctrl+'-' are left alone -
        // those are the grid thumbnail zoom menu accelerators (app.ts) - and so
        // is typing in a text field (e.g. FoldersZoom's new-folder name).
        useEffect(() => {
            if (!openModal || !mediaWithPreview.mime.includes('video')) return
            const onKeyDown = (ev: KeyboardEvent) => {
                if (ev.ctrlKey || ev.altKey || ev.metaKey) return
                if (ev.key !== '+' && ev.key !== '-') return
                if (ev.code.startsWith('Numpad')) return
                const target = ev.target as HTMLElement | null
                if (target?.closest?.('input:not([type="checkbox"]), textarea, [contenteditable="true"]')) return
                stepVolume(ev.key === '+' ? 1 : -1)
                ev.preventDefault()
            }
            window.addEventListener('keydown', onKeyDown)
            return () => window.removeEventListener('keydown', onKeyDown)
        }, [openModal, mediaWithPreview.mime])

        const copyPathToClipboard = (): void => {
            navigator.clipboard.writeText(mediaWithPreview.path).then(() => {
                setPathCopied(true)
                setTimeout(() => setPathCopied(false), 1500)
            }).catch((error) => {
                console.error("Failed to copy media path to clipboard", error)
            })
        }


        useImperativeHandle(ref, () => ({
            chamgeImageClass() {
                if (imgRef.current)
                    imageUnset()
            },
            fullScreenVideo() {
                if (videoRef.current)
                    videoRef.current.requestFullscreen()
            },
            togleVideoControls() {
                if (videoRef.current)
                    togleVideoControls()
            },
            playPauseVideo() {
                if (videoRef.current) {
                    if (videoRef.current.paused) {
                        videoRef.current.play()
                    } else {
                        videoRef.current.pause()
                    }
                }
            },
            maxVolume() {
                const videoInZoom: any = videoRef.current
                if (!videoInZoom)
                    return
                videoInZoom.volume = 1
            },
            minVolume() {
                const videoInZoom: any = videoRef.current
                if (!videoInZoom)
                    return
                videoInZoom.volume = 0.001
            }
        }));



        // One 0.2 wheel notch, rounded to the sliders' 0.1 step and clamped to
        // their range (image 0.3-10, video 1-10).
        const stepZoom = (zoom: number, deltaY: number, min: number): number =>
            Math.min(10, Math.max(min, Math.round((zoom + (deltaY > 0 ? -0.2 : 0.2)) * 10) / 10))

        // Ctrl+wheel zooms whichever media is open - on the media itself and on
        // the controls bar alike. A plain wheel is left to scroll.
        const zoomMedia = (event: any): void => {
            if (!event.ctrlKey)
                return
            if (mediaWithPreview.mime.includes('video'))
                setVideoZoom(zoom => stepZoom(zoom, event.deltaY, 1))
            else
                setImageZoom(zoom => stepZoom(zoom, event.deltaY, 0.3))
            event.stopPropagation();
        }

        // Shift+wheel steps the volume, Ctrl+wheel zooms. Chromium turns a
        // Shift+wheel into a horizontal scroll, so the notch arrives in deltaX.
        const wheelOnVideo = (event: any): void => {
            if (event.shiftKey) {
                const delta = event.deltaY || event.deltaX
                if (delta) stepVolume(delta > 0 ? -1 : 1)
                event.stopPropagation();
                return
            }
            zoomMedia(event)
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
            const divImgCurrent = divImgRef.current
            if (!divImgCurrent)
                return
            if (!imgCurrent)
                return
            if (imgCurrent.classList.contains("imageAddaptScreen")){
                imgCurrent.classList.remove("imageAddaptScreen")
                divImgCurrent.classList.remove("divAddaptScreen")
            } else {
                imgCurrent.classList.add("imageAddaptScreen")
                divImgCurrent.classList.add("divAddaptScreen")
            }

            imgCurrent.focus()

        }

        function startVid(event: SyntheticEvent<HTMLVideoElement, Event>): void {
            const video = event.currentTarget
            if (!video) return
            event.currentTarget.volume = config.videoVolume
            setDuration(video.duration)
        }

        function saveVideoVolume(event: SyntheticEvent<HTMLVideoElement, Event>): void {
            const volume = event.currentTarget.volume
            setVolumeLevel(volume)
            dispatch(setVideoVolume(volume))
        }

        function updateVideoTime(event: SyntheticEvent<HTMLVideoElement, Event>): void {
            setCurrentTime(event.currentTarget.currentTime)
        }

        function formatTime(seconds: number): string {
            if (!isFinite(seconds) || seconds < 0) return "00:00"
            const totalSeconds = Math.floor(seconds)
            const hours = Math.floor(totalSeconds / 3600)
            const minutes = Math.floor((totalSeconds % 3600) / 60)
            const secs = totalSeconds % 60
            const pad = (n: number) => n.toString().padStart(2, "0")
            return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`
        }



        function dragControlVideo(event: any): void {
            const duration = videoRef.current ? videoRef.current.duration : 0
            if (event.ctrlKey && videoRef.current && !isNaN(duration)) {
                const video = videoRef.current
                try {
                    video.currentTime = (event.clientX / window.innerWidth) * duration
                } catch (error) {
                    console.info(`Error trying to change video time: ${error} 
                        currentTime: ${video.currentTime},
                        clientWidth: ${video.clientWidth},
                        duration: ${video.duration},
                        event.clientX: ${event.clientX}`)
                }
                event.stopPropagation();
            }
        }

        const togleVideoControls = (): void => {
            const videoInZoom: any = videoRef.current
            if (!videoInZoom)
                return
            videoInZoom.controls = !videoInZoom.controls
        }

        const MediaControllers = () => {
            return <MediaControllersCSS onWheel={zoomMedia}>


                {mediaWithPreview.mime.includes('video') ?
                    <>
                        <FoldersZoom mediaOnlyCopy={mediaWithPreview} handleExternalClose={handleExternalClose} />
                        <input style={{ zoom: 2 }} type="checkbox" onClick={changeCheckbox} id="selectMedia" defaultChecked={mediaWithPreview.checked} />
                        <Slider
                            aria-label="Video zoom"
                            value={videoZoom}
                            valueLabelDisplay="auto"
                            shiftStep={0.5}
                            step={0.1}
                            min={1}
                            max={10}
                            onChange={(event: Event, newValue: number | number[]) => setVideoZoom(newValue as number)}
                        />
                    </>
                    :
                    <>
                        <IconButton onClick={imageUnset}><CleaningServices /></IconButton>
                        <Slider
                            aria-label="Zoom"
                            value={imageZoom}
                            //   getAriaValueText={valuetext}
                            valueLabelDisplay="auto"
                            shiftStep={0.5}
                            step={0.1}
                            min={0.3}
                            max={10}
                            onChange={(event: Event, newValue: number | number[]) => setImageZoom(newValue as number)}
                        />
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

        function changeCheckbox(event: any): void {
            const aux = { ...mediaWithPreview }
            aux.checked = !mediaWithPreview.checked
            dispatch(updateArrayItem(aux))
            handleExternalClose();
        }



        return (
            <Modal
                open={!!openModal}
                onClose={handleExternalClose}
                aria-labelledby="modal-modal-title"
                aria-describedby="modal-modal-description"
                onMouseMove={(ev: any) => dragControlVideo(ev)}
            >

                <ModalBox >
                    <ZoomHeader>
                        {onPrev && <IconButton onClick={onPrev}><ArrowBackIos /></IconButton>}
                        {onNext && <IconButton onClick={onNext}><ArrowForwardIos /></IconButton>}
                        <input style={{ cursor: 'pointer' }} type="checkbox" onClick={changeCheckbox} id="selectMedia" defaultChecked={mediaWithPreview.checked} />
                        <label htmlFor="selectMedia" style={{ cursor: 'pointer', userSelect: 'none', fontSize: '14px', marginRight: '8px' }}>Select</label>
                        <IconButton onClick={toggleDetections}
                            color={showDetections ? "primary" : "default"}
                            title={detectedObjects.length > 0 ? `${showDetections ? "Hide" : "Show"} ${detectedObjects.length} detected object(s)` : "No objects detected for this media"}>
                            <Label />
                        </IconButton>
                        {isAnimated &&
                            <IconButton onClick={() => setShowDetectionFrames(v => !v)}
                                color={showDetectionFrames ? "primary" : "default"}
                                title={showDetectionFrames ? "Hide the detection frames" : "Show the frames used for object detection"}>
                                <Image />
                            </IconButton>}
                        <FoldersZoom mediaOnlyCopy={mediaWithPreview} handleExternalClose={handleExternalClose} />
                    </ZoomHeader>
                    {mediaWithPreview.mime.includes('video') &&
                        <VideoProgress  value={duration > 0 ? (currentTime / duration) * 100 : 0} />
                    }
                    {showFramesPanel &&
                        <FramesPanel>
                            {frames.length === 0 && <span>No extracted frames for this media</span>}
                            {frames.map(frame => (
                                <FrameTile key={frame} title={frame}>
                                    <img src={toMediaUrl(frame)} alt={frame} draggable={false} />
                                    {showDetections && boxesForFrame(frame).map((box, idx) => (
                                        <DetectionBoxOutline key={idx} x={box.x} y={box.y} w={box.w} h={box.h}>
                                            <DetectionBoxLabel>{box.className} {(box.score * 100).toFixed(0)}%</DetectionBoxLabel>
                                        </DetectionBoxOutline>
                                    ))}
                                </FrameTile>
                            ))}
                        </FramesPanel>}
                    <MediaPresentation style={showFramesPanel ? { width: '80%', left: '40%' } : undefined}>
                        {
                            mediaWithPreview.mime.includes('video')
                                ?
                                <>
                                    <VideoPresentation ref={videoRef} src={toMediaUrl(mediaWithPreview.path)}
                                        onLoadedMetadata={startVid}
                                        onDoubleClick={changeCheckbox}
                                        onWheel={wheelOnVideo}
                                        onVolumeChange={saveVideoVolume}
                                        onTimeUpdate={updateVideoTime}
                                        style={{ transform: `scale(${videoZoom})`, transformOrigin: 'top left' }}
                                        autoPlay title={`${mediaWithPreview.path}\n${prettifySizeF(mediaWithPreview.size)}`} ></VideoPresentation>
                                    <InfoBox>
                                        {!mediaWithPreview.hasAudio ? <MuteIcon color="error" /> : <span>{`${(volumeLevel * 100).toFixed(2)}%`}</span>}
                                        <span>{`${formatTime(currentTime)} / ${formatTime(duration)}`}</span>
                                        <IconButton onClick={copyPathToClipboard} title={pathCopied ? "Copied!" : "Copy file path to clipboard"}>
                                            {pathCopied ? <Check color="success" /> : <ContentCopy />}
                                        </IconButton>
                                    </InfoBox>
                                </>
                                :
                                <>
                                    <ImgWrapper ref={divImgRef} onWheel={zoomMedia}>
                                        <ImgPresentation
                                            onDoubleClick={changeCheckbox}
                                            draggable={false}
                                            style={{ zoom: imageZoom }}
                                            ref={imgRef} src={toMediaUrl(mediaWithPreview.path)}
                                            alt={mediaWithPreview.path} title={`${mediaWithPreview.path}\n${prettifySizeF(mediaWithPreview.size)}`} ></ImgPresentation>
                                        {showDetections && detectedObjects.map((box, idx) => (
                                            <DetectionBoxOutline key={idx} x={box.x} y={box.y} w={box.w} h={box.h}>
                                                <DetectionBoxLabel>{box.className} {(box.score * 100).toFixed(0)}%</DetectionBoxLabel>
                                            </DetectionBoxOutline>
                                        ))}
                                    </ImgWrapper>
                                    <InfoBox>
                                        <IconButton onClick={copyPathToClipboard} title={pathCopied ? "Copied!" : "Copy file path to clipboard"}>
                                            {pathCopied ? <Check color="success" /> : <ContentCopy />}
                                        </IconButton>
                                    </InfoBox>
                                </>
                        }
                    </MediaPresentation>
                    {/* Called, not mounted as <MediaControllers />: it's redefined every
                        render, so onTimeUpdate's re-renders would remount the sliders mid-drag. */}
                    {MediaControllers()}
                </ModalBox>

            </Modal>
        )

    })

export default ModalZoom