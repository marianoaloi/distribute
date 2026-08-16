import path from "path";
import fs from "fs";
import { getTmpRoot } from "../DirectorioCache";

// SQLite file backing the perceptual-hash index (see HashStore.js)
export const getDbDir = (): string => path.join(getTmpRoot(), "hashIndex");
export const getDbPath = (): string => path.join(getDbDir(), "index.db");

// Extracted video frames (kept so re-scanning a folder doesn't re-invoke ffmpeg)
export const getFramesDir = (): string => path.join(getTmpRoot(), "frames");

export const ensureFramesDir = (): void => {
    fs.mkdirSync(getFramesDir(), { recursive: true });
};
