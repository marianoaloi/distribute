import { IconButton, CircularProgress, LinearProgress } from "@mui/material"
import { PlayArrow } from "@mui/icons-material"
import { Media } from "../entity/Media"
import { RunDetection, selectDetecting, selectDetectionError, selectDetectionProgress, selectDetections, selectMedias, useSelector } from "../lib/redux"
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

    const runDetection = () => dispatch(RunDetection(medias))

    return (
        <div>
            <DetectionResume>
                <IconButton onClick={runDetection} disabled={detecting || medias.length === 0}
                    title="Run ONNX object detection (xcxv/best.onnx) over every loaded media">
                    {detecting ? <CircularProgress size={20} /> : <PlayArrow />}
                </IconButton>
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
