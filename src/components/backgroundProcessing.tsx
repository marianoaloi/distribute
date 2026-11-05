import { PipelineStatus } from "./pipelineStatus"

// Must match the kind app.ts passes to pipelineRun for the "Load super
// background" menu item - App uses it to tell that run apart from the others.
export const SUPER_BACKGROUND_KIND = "Load super background"

// Only screen shown while a background run is active: the main process sends
// no media until the whole pipeline ends, so there is nothing to browse and
// therefore no header, view switch or grid navigation - just the progress.
export const BackgroundProcessing = (() => (
    <>
        <PipelineStatus fullScreen />
        {/* Sits under the full-screen panel's centered content. */}
        <div style={{ position: "fixed", bottom: 24, left: 0, right: 0, textAlign: "center", zIndex: 12, color: "rgba(255, 255, 255, 0.5)", fontSize: 14 }}>
            Media will load when processing finishes
        </div>
    </>
))
