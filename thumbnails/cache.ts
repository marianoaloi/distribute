import path from "path";
import fs from "fs";
import crypto from "crypto";
import { getTmpRoot } from "../DirectorioCache";

export const getCacheDir = (): string => path.join(getTmpRoot(), "frames");

export const ensureCacheDir = (): void => {
    fs.mkdirSync(getCacheDir(), { recursive: true });
};

export const hashFor = (videoPath: string): string => crypto.createHash("md5").update(videoPath).digest("hex");

// contentMd5 is optional so every existing call site keeps working while the
// value is still unknown (it's filled in by a background backfill, not on
// the load path) - falls back to the path hash until then.
export const thumbnailPathFor = (videoPath: string, idMedia?: string | null): string =>
    path.join(getCacheDir(), `${idMedia || hashFor(videoPath)}_end10s.jpg`);

// Directory for the hard-link retry: fs.linkSync requires the link to be on
// the same volume as the source video, which the ffmpeg cache dir now is,
// since both live under the folder the user opened.
export const getLinkDir = (): string => getCacheDir();
