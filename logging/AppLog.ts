import fs from "fs";
import path from "path";
import log from "electron-log/main";
import { getTmpRoot } from "../DirectorioCache";

// Every module in this app logs with plain console.log/console.error
// (mediaIndexer.ts, videoFrames.ts, pixelHash.ts, app.ts, ...) - rather
// than touching each call site, electron-log's documented console-takeover
// (see its README's "Take over console.log") routes all of those into its
// own file+console transports for free. Import this module FIRST, before
// anything else that might log, so nothing early gets missed.
Object.assign(console, log.functions);

// index.db/hashIndex/frames all live under the active folder's own tmp/
// (see DirectorioCache.ts) rather than a machine-wide temp dir, so a run's
// log travels with the same folder instead of getting mixed in with every
// other folder ever opened. logs/ is its own subdirectory alongside
// hashIndex/ and frames/, not loose files directly under tmp/.
const LOG_FILE_NAME = "app.log";

// resolvePathFn (see electron-log's file transport) is called fresh on
// every single write, not cached once - so redirecting here takes effect
// immediately, mid-run, the next time anything logs.
log.transports.file.resolvePathFn = () => path.join(getTmpRoot(), "logs", LOG_FILE_NAME);

// A run over a real library can produce thousands of lines (one per item
// indexed, per compareImg/mediaIndexer.ts's new "now processing" logging) -
// big enough to want rotation, small enough that 5MB comfortably holds a
// full run rather than truncating mid-run right when something goes wrong.
log.transports.file.maxSize = 5 * 1024 * 1024;

// Points the file transport at the given folder's tmp/logs/ (creating it if
// needed) - call this everywhere the active folder changes (see app.ts's
// setActiveFolder call sites) so the log file always matches whichever
// folder is actually being processed.
export const redirectToActiveFolder = (): void => {
    try {
        fs.mkdirSync(path.join(getTmpRoot(), "logs"), { recursive: true });
    } catch (error) {
        console.error("AppLog: failed to create log directory", (error as Error).message);
    }
};

// Catches whatever would otherwise crash the main process silently (or with
// only a raw, unformatted stack on stderr) - logged, not popped as a native
// dialog, since a long unattended run (loadSuperRecursive) shouldn't be
// interrupted by a blocking prompt over a single bad item.
log.errorHandler.startCatching({ showDialog: false });

redirectToActiveFolder();

export default log;
