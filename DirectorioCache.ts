import os from "os";
import path from "path";

const isDev = process.env.NODE_ENV === "development";

// Used until the user opens a folder (e.g. app startup, before any "open"/
// "open recursive" dialog has resolved).
const defaultDir = isDev ? process.cwd() : os.tmpdir();

let activeFolder: string | null = null;

// Called whenever the user picks a folder (plain open or recursive open) so
// tmp/ffmpeg, tmp/frames and tmp/hashIndex live inside that folder instead of
// a machine-wide temp dir.
export const setActiveFolder = (folder: string): void => {
    activeFolder = folder;
};

export const getTmpRoot = (): string => path.join(activeFolder || defaultDir, "tmp");
