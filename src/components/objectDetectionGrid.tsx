import { IconButton, CircularProgress, LinearProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Button, TextField } from "@mui/material"
import { PlayArrow, Stop, FolderOpen, Label } from "@mui/icons-material"
import React from "react"
import { Media } from "../entity/Media"
import { ChooseOnnxModel, LoadDetectionClasses, RunDetection, SaveDetectionClasses, StopDetection, selectDetecting, selectDetectionClassNames, selectDetectionError, selectDetectionProgress, selectDetections, selectLastProcessedId, selectMedias, selectModelPath, useSelector } from "../lib/redux"
import { useDispatch } from "react-redux"
import { configurationsSelector } from "../lib/redux/slices/configurations"
import { toMediaUrl } from "../lib/mediaUrl"
import { DetectionBoxLabel, DetectionBoxOutline, DetectionGridWrap, DetectionResume, DetectionTile, EmptyState } from "./objectDetectionGrid.styled"

// The grid only renders this many tiles at once - with large folders, mounting
// thousands of <img> tags tanks render/scroll performance. Detection itself
// still runs over every loaded media (see runDetection below); only the
// on-screen list is capped.
const MAX_VISIBLE_MEDIAS = 500

// Once the run has gone 3/4 of the way through the visible window, slide the
// window forward so the grid keeps showing what's coming up next instead of
// piling up everything already processed. WINDOW_SHIFT is how far back
// (from the item just processed) the new window starts, i.e. how much
// already-processed context stays on screen after the slide.
const WINDOW_SHIFT_TRIGGER = Math.floor(MAX_VISIBLE_MEDIAS * 3 / 4)
const WINDOW_SHIFT = MAX_VISIBLE_MEDIAS - WINDOW_SHIFT_TRIGGER

export const GridDetections = (() => {

    const dispatch = useDispatch<any>();

    const medias = useSelector(selectMedias).filter((m: Media) => !m.deleted && !m.imported)
    const detections = useSelector(selectDetections)
    const detecting = useSelector(selectDetecting)
    const detectionError = useSelector(selectDetectionError)
    const progress = useSelector(selectDetectionProgress)
    const config = useSelector(configurationsSelector)
    const modelPath = useSelector(selectModelPath)
    const modelName = modelPath ? modelPath.split(/[\\/]/).pop() : null
    const classNames = useSelector(selectDetectionClassNames)
    const lastProcessedId = useSelector(selectLastProcessedId)

    const [windowStart, setWindowStart] = React.useState(0)
    const windowEnd = Math.min(windowStart + MAX_VISIBLE_MEDIAS, medias.length)
    const visibleMedias = medias.slice(windowStart, windowEnd)

    const [openClassNames, setOpenClassNames] = React.useState(false)

    const chooseModel = () => dispatch(ChooseOnnxModel())
    const runDetection = () => dispatch(RunDetection(medias))
    const stopDetection = () => dispatch(StopDetection())
    const openClassNamesDialog = () => setOpenClassNames(true)
    const closeClassNamesDialog = () => setOpenClassNames(false)

    React.useEffect(() => {
        dispatch(LoadDetectionClasses())
    }, [dispatch])

    // index.db is per-folder, so the class list must be re-fetched every time
    // a folder finishes loading, not only on mount.
    React.useEffect(() => {
        if (!config.mediaLoading) {
            dispatch(LoadDetectionClasses())
        }
    }, [config.mediaLoading, dispatch])

    // Follow the run: keep the image that was just processed on screen. Parallel
    // batches finish several items a second, so this must be an instant scroll -
    // queued smooth-scroll animations would lag behind the run and look janky.
    const scrolledToRef = React.useRef<string | null>(null)
    React.useEffect(() => {
        if (scrolledToRef.current === null && lastProcessedId !== null) {
            // First render after a (re)mount: adopt whatever the store already holds
            // without scrolling, so switching back to this tab does not yank the
            // view to an image from a run that already finished.
            scrolledToRef.current = lastProcessedId
            return
        }
        if (!lastProcessedId || lastProcessedId === scrolledToRef.current) return
        scrolledToRef.current = lastProcessedId
        document.getElementById(`detection-media-${lastProcessedId}`)
            ?.scrollIntoView({ block: "center", behavior: "auto" })
    }, [lastProcessedId])

    // Start each fresh run showing from the top of the list.
    React.useEffect(() => {
        if (detecting) {
            setWindowStart(0)
        }
    }, [detecting])

    // Backend processes medias in the same order they were sent, so the index
    // of the last processed item tells us how far through the window the run
    // is. Once it crosses the 3/4 mark, slide the window forward so the
    // already-recognized items at the front drop off the grid and upcoming
    // ones scroll into view instead.
    React.useEffect(() => {
        if (!detecting || !lastProcessedId) return
        const processedIndex = medias.findIndex(m => m.id === lastProcessedId)
        if (processedIndex < 0) return
        if (processedIndex - windowStart >= WINDOW_SHIFT_TRIGGER) {
            setWindowStart(Math.max(0, processedIndex - WINDOW_SHIFT))
        }
    }, [lastProcessedId, detecting, medias, windowStart])

    return (
        <div>
            <DetectionResume>
                <IconButton onClick={chooseModel}
                    title={modelPath ? `Model: ${modelPath} (click to change)` : "Choose an ONNX model file"}>
                    <FolderOpen />
                </IconButton>
                <IconButton onClick={runDetection} disabled={detecting || medias.length === 0 || !modelPath}
                    title={modelPath ? `Run ONNX object detection (${modelName}) over every loaded media` : "Choose an ONNX model file first"}>
                    {detecting ? <CircularProgress size={20} /> : <PlayArrow />}
                </IconButton>
                <IconButton onClick={stopDetection} disabled={!detecting || !modelPath}
                    title="Stop after the current batch — results found so far stay on screen">
                    <Stop />
                </IconButton>
                <IconButton onClick={openClassNamesDialog}
                    title="Edit the detection class names (comma-separated, position = class id)">
                    <Label />
                </IconButton>
                {modelName && <span title={modelPath ?? undefined}>Model: {modelName}</span>}
                <span>{Object.keys(detections).length} media scanned</span>
                {medias.length > MAX_VISIBLE_MEDIAS &&
                    <span title="All loaded media are still sent to detection - only the grid view is capped">
                        Showing {windowStart + 1}-{windowEnd} of {medias.length}
                    </span>}
                {detectionError && <span>Detection failed: {detectionError}</span>}
                <div className="spacer" />
            </DetectionResume>

            <Dialog
                open={openClassNames}
                onClose={closeClassNamesDialog}
                PaperProps={{
                    component: 'form',
                    onSubmit: (event: React.FormEvent<HTMLFormElement>) => {
                        event.preventDefault();
                        const formData = new FormData(event.currentTarget);
                        const formJson = Object.fromEntries((formData as any).entries());
                        dispatch(SaveDetectionClasses(formJson.classes))
                        closeClassNamesDialog();
                    },
                }}
            >
                <DialogTitle>Detection class names</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Comma-separated class names — position 0 is class 0, position 1 is class 1, and so on.
                    </DialogContentText>
                    <TextField
                        autoFocus
                        margin="dense"
                        id="classes"
                        name="classes"
                        label="Class names"
                        type="text"
                        fullWidth
                        multiline
                        variant="standard"
                        defaultValue={classNames.join(', ')}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeClassNamesDialog}>Cancel</Button>
                    <Button type="submit">Save</Button>
                </DialogActions>
            </Dialog>

            {detecting &&
                <LinearProgress
                    variant={progress && progress.total > 0 ? "determinate" : "indeterminate"}
                    value={progress && progress.total > 0 ? (progress.processed / progress.total) * 100 : 0}
                />
            }

            {medias.length > 0
                ? <DetectionGridWrap>
                    {visibleMedias.map(media => (
                        <DetectionTile id={`detection-media-${media.id}`} key={media.id} size={config.pxzoom}>
                            <img src={toMediaUrl(media.media)} alt={media.filename} draggable={false} />
                            {(detections[media.id] || []).map((box, idx) => (
                                <DetectionBoxOutline key={idx} x={box.x} y={box.y} w={box.w} h={box.h}>
                                    <DetectionBoxLabel>{box.className} {(box.score * 100).toFixed(0)}%</DetectionBoxLabel>
                                </DetectionBoxOutline>
                            ))}
                        </DetectionTile>
                    ))}
                </DetectionGridWrap>
                : <EmptyState>No media loaded yet. Open a folder first, then run detection.</EmptyState>
            }
        </div>
    )
})
