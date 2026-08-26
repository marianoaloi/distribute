import { ReduxState } from "../../store";

export const selectPipelineRunning = (state: ReduxState) => state.pipeline.running;
export const selectPipelineKind = (state: ReduxState) => state.pipeline.kind;
export const selectPipelineStartedAt = (state: ReduxState) => state.pipeline.startedAt;
export const selectPipelineStage = (state: ReduxState) => state.pipeline.stage;
export const selectPipelineEtaStageMs = (state: ReduxState) => state.pipeline.etaStageMs;
export const selectPipelineEtaOverallMs = (state: ReduxState) => state.pipeline.etaOverallMs;
export const selectPipelineError = (state: ReduxState) => state.pipeline.error;
export const selectPipelineRejectedMessage = (state: ReduxState) => state.pipeline.rejectedMessage;
