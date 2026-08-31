import { LinearProgress, Snackbar, Alert } from "@mui/material"
import { useDispatch } from "react-redux"
import {
    clearPipelineRejected,
    dismissPipelineError,
    selectPipelineEtaOverallMs,
    selectPipelineEtaStageMs,
    selectPipelineError,
    selectPipelineKind,
    selectPipelineRejectedMessage,
    selectPipelineRunning,
    selectPipelineStage,
    dismissUndoResult,
    selectUndoLastRestored,
    selectUndoLastSkipped,
    useSelector,
} from "../lib/redux"
import { EtaGroup, LiveDot, PipelineBar, PipelineTopRow, StageCounter, StageLabel } from "./pipelineStatus.styled"

// mm:ss under an hour, h:mm:ss beyond it - an ETA display only needs to be
// glanceable, not to the second.
const formatDuration = (ms: number): string => {
    const totalSeconds = Math.round(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    const mm = minutes.toString().padStart(hours > 0 ? 2 : 1, "0")
    const ss = seconds.toString().padStart(2, "0")
    return hours > 0 ? `${hours}:${mm.padStart(2, "0")}:${ss}` : `${mm}:${ss}`
}

// Single persistent banner for loadSuperRecursive's whole scan -> hash ->
// index -> detect -> duplicates chain (see app.ts's pipelineRun/pipeline
// redux slice) - rendered above the page header regardless of which view is
// open, so "is this still running" never depends on which tab the user is
// looking at, and a live pulse + elapsed/ETA numbers make it plain the app
// hasn't stalled even during a stage with no visible new results.
export const PipelineStatus = (() => {
    const dispatch = useDispatch()

    const running = useSelector(selectPipelineRunning)
    const kind = useSelector(selectPipelineKind)
    const stage = useSelector(selectPipelineStage)
    const etaStageMs = useSelector(selectPipelineEtaStageMs)
    const etaOverallMs = useSelector(selectPipelineEtaOverallMs)
    const error = useSelector(selectPipelineError)
    const rejectedMessage = useSelector(selectPipelineRejectedMessage)
    const undoRestored = useSelector(selectUndoLastRestored)
    const undoSkipped = useSelector(selectUndoLastSkipped)

    return (
        <>
            {running &&
                <PipelineBar>
                    <PipelineTopRow>
                        <LiveDot />
                        <StageLabel>{kind}{stage ? ` — ${stage.label}` : ""}</StageLabel>
                        {stage && <StageCounter>
                            step {stage.index + 1}/{stage.count}
                            {stage.total > 0 ? ` · ${stage.processed}/${stage.total}` : ""}
                        </StageCounter>}
                        <EtaGroup>
                            {etaStageMs !== null && <span>stage ETA {formatDuration(etaStageMs)}</span>}
                            {etaOverallMs !== null && <span>overall ETA {formatDuration(etaOverallMs)}</span>}
                        </EtaGroup>
                    </PipelineTopRow>
                    <LinearProgress
                        variant={stage && stage.total > 0 ? "determinate" : "indeterminate"}
                        value={stage && stage.total > 0 ? (stage.processed / stage.total) * 100 : 0}
                    />
                </PipelineBar>
            }

            <Snackbar open={!!rejectedMessage} autoHideDuration={5000} onClose={() => dispatch(clearPipelineRejected())}>
                <Alert onClose={() => dispatch(clearPipelineRejected())} severity="warning" variant="filled">
                    {rejectedMessage}
                </Alert>
            </Snackbar>

            <Snackbar open={!running && !!error} autoHideDuration={8000} onClose={() => dispatch(dismissPipelineError())}>
                <Alert onClose={() => dispatch(dismissPipelineError())} severity="error" variant="filled">
                    {kind ? `${kind} failed: ${error}` : error}
                </Alert>
            </Snackbar>

            {/* An undo that could not put every file back has to say so: a file
                someone moved out of its destination outside this app cannot be
                restored, and silently coming up short would leave the user
                believing the move was reversed when it was not. */}
            <Snackbar open={undoRestored !== null} autoHideDuration={undoSkipped.length > 0 ? 10000 : 4000}
                onClose={() => dispatch(dismissUndoResult())}>
                <Alert onClose={() => dispatch(dismissUndoResult())} variant="filled"
                    severity={undoSkipped.length > 0 ? "warning" : "success"}>
                    {`Undo restored ${undoRestored} file${undoRestored === 1 ? "" : "s"}`}
                    {undoSkipped.length > 0 && ` — ${undoSkipped.length} could not be put back (${undoSkipped[0].reason})`}
                </Alert>
            </Snackbar>
        </>
    )
})
