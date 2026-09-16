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
    dismissSortResult,
    selectSortResult,
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
    const sortResult = useSelector(selectSortResult)

    // Everything the sort could not move, so a run that quietly did less than
    // expected still says why rather than just reporting a smaller number.
    const sortUnhandled = sortResult
        ? sortResult.missing + sortResult.blocked + sortResult.failed.length
        : 0

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

            {/* Result of sending filed media back into per-kind folders. The
                counts that are not "moved" matter most: they are the files the
                run deliberately left alone. */}
            <Snackbar open={sortResult !== null} autoHideDuration={sortUnhandled > 0 ? 10000 : 5000}
                onClose={() => dispatch(dismissSortResult())}>
                <Alert onClose={() => dispatch(dismissSortResult())} variant="filled"
                    severity={sortResult && sortResult.failed.length > 0 ? "warning" : "success"}>
                    {sortResult && <>
                        {`Sorted ${sortResult.moved} file${sortResult.moved === 1 ? "" : "s"} into kind folders`}
                        {sortResult.alreadyInPlace > 0 && ` · ${sortResult.alreadyInPlace} already in place`}
                        {sortResult.missing > 0 && ` · ${sortResult.missing} not found`}
                        {sortResult.blocked > 0 && ` · ${sortResult.blocked} blocked by a same-named file`}
                        {sortResult.failed.length > 0 && ` · ${sortResult.failed.length} failed`}
                    </>}
                </Alert>
            </Snackbar>
        </>
    )
})
