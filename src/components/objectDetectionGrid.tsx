import { IconButton, CircularProgress, LinearProgress } from "@mui/material"
import { PlayArrow, Stop, FolderOpen } from "@mui/icons-material"
import { Media } from "../entity/Media"
import { ChooseOnnxModel, RunDetection, StopDetection, selectDetecting, selectDetectionError, selectDetectionProgress, selectDetections, selectMedias, selectModelPath, useSelector } from "../lib/redux"
import { useDispatch } from "react-redux"
import { configurationsSelector } from "../lib/redux/slices/configurations"
import { toMediaUrl } from "../lib/mediaUrl"
import { DetectionBoxLabel, DetectionBoxOutline, DetectionGridWrap, DetectionResume, DetectionTile, EmptyState } from "./objectDetectionGrid.styled"

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

    const chooseModel = () => dispatch(ChooseOnnxModel())
    const runDetection = () => dispatch(RunDetection(medias))
    const stopDetection = () => dispatch(StopDetection())

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
                <IconButton onClick={stopDetection} disabled={!detecting}
                    title="Stop after the current item — results found so far stay on screen">
                    <Stop />
                </IconButton>
                {modelName && <span>Model: {modelName}</span>}
                <span>{Object.keys(detections).length} media scanned</span>
                {detectionError && <span>Detection failed: {detectionError}</span>}
                <div className="spacer" />
            </DetectionResume>

            {detecting &&
                <LinearProgress
                    variant={progress && progress.total > 0 ? "determinate" : "indeterminate"}
                    value={progress && progress.total > 0 ? (progress.processed / progress.total) * 100 : 0}
                />
            }

            {medias.length > 0
                ? <DetectionGridWrap>
                    {medias.map(media => (
                        <DetectionTile key={media.id} size={config.pxzoom}>
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
