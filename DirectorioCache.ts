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

// Name of the app's own folder inside every opened folder: move destinations
// plus app data (frames, hashIndex, logs). Recursive scans skip it.
export const TMP_FOLDER_NAME = "tmp";

// The opened folder: the one whose tmp/hashIndex/index.db is in use, and the
// folder every path stored in that database is relative to.
export const getActiveRoot = (): string => activeFolder || defaultDir;

export const getTmpRoot = (): string => path.join(getActiveRoot(), TMP_FOLDER_NAME);

// target's path below root, or null when target is root itself or lies
// outside it. path.relative copes with separators and, on win32, with
// case-insensitive drives and segments; the isAbsolute guard catches a
// different drive.
export const relativeInside = (root: string, target: string): string | null => {
    const rel = path.relative(path.resolve(root), path.resolve(target));
    if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
    return rel;
};

// A media path as the database stores it: relative to the opened folder with
// "/" separators (e.g. "family/2006/a.jpg"), so index.db keeps working when
// the folder is moved, copied or reached through another drive letter or
// mount point. A path outside the folder stays absolute. A path that is
// already relative is taken as already stored.
export const toStoredPath = (filePath: string, root: string = getActiveRoot()): string => {
    if (!path.isAbsolute(filePath)) return filePath.split(path.sep).join("/");
    const rel = relativeInside(root, filePath);
    return rel === null ? filePath : rel.split(path.sep).join("/");
};

// The inverse of toStoredPath: the absolute path the rest of the app works with.
export const fromStoredPath = (stored: string, root: string = getActiveRoot()): string =>
    path.isAbsolute(stored) ? stored : path.join(root, stored);

// Where a move into destination folder `dest` puts sourcePath:
// <root>/tmp/<dest>/<the file's subfolder below root>/<file name>. Keeping the
// subfolder means a recursive load's same-named files from different folders
// (family/2006/a.jpg, family/2007/a.jpg) never land on top of each other. A
// file directly in root, or outside it, goes straight into <root>/tmp/<dest>.
export const moveTargetFor = (root: string, dest: string, sourcePath: string): string => {
    const subfolder = relativeInside(root, path.dirname(sourcePath)) ?? "";
    return path.join(root, TMP_FOLDER_NAME, dest, subfolder, path.basename(sourcePath));
};
