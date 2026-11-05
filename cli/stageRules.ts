// Pure rules shared by the headless LSR runner (cli/lsr.ts) and its stage
// runners (cli/stages.ts). No native imports: unit-testable under jest.
import type { StageDef } from "../pipeline/PipelineRun";

// A stage-level failure: the stage is reported FAILED and the run exits 3.
export class StageFailure extends Error { }

// Pixel-duplicate buckets above this many frames get exact matches only (see
// duplicateFinder.findIndexDuplicatesBucketed): one degenerate bucket - all
// black frames, say - would otherwise cost k^2 pixel comparisons.
export const MAX_DUPLICATE_BUCKET = 5000;

// A stage that tried at least this many items and got not one of them
// through is FAILED (exit 3, later stages skipped): that is almost always
// system-wide (ffmpeg missing, disk full, read-only database). Fewer
// failures - one corrupt new file on a re-run, say - stay item errors
// (exit 1), so a single bad file can never block every future run.
export const ALL_FAILED_MIN_ITEMS = 5;

// alreadyDone: items of this stage finished by EARLIER runs. A re-run only
// retries the leftovers - mostly the permanently bad files - so "none of
// this run's items succeeded" alone would turn a handful of bad files into
// a FAILED stage on every re-run; with earlier successes it is not system-wide.
export const everyItemFailed = (succeeded: number, failed: number, alreadyDone = 0): boolean =>
    failed >= ALL_FAILED_MIN_ITEMS && succeeded === 0 && alreadyDone === 0;

export const allFailedError = (stage: string, failed: number): StageFailure =>
    new StageFailure(`every one of the ${failed} items the ${stage} stage tried failed - most likely a system-wide problem (ffmpeg missing, disk full, read-only database); see the log`);

// Stages the GUI chain does not have.
export const CLI_ONLY_STAGES: StageDef[] = [
    { key: "extraDups", label: "Running the other duplicate algorithms" },
    { key: "report", label: "Writing the decision report" },
];
