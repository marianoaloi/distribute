import fs from "fs";
import ffmpegStaticPath from "ffmpeg-static";

// Shared by videoFrames.ts (frame extraction) and pixelHash.ts (the
// baseGrey/baseMd5 fingerprint). Extracted because the asar fixup below is
// easy to omit in a new call site and the omission only ever shows up in a
// packaged build, never in dev.
let resolved: string | null = null;
try {
    resolved = ffmpegStaticPath;
    // ffmpeg-static resolves to a path inside app.asar once packaged, and a
    // binary cannot be executed from inside the archive - electron-builder
    // unpacks it, so the path has to be redirected to match.
    if (resolved) resolved = resolved.replace("app.asar", "app.asar.unpacked");
} catch {
    resolved = null;
}

export const ffmpegPath = resolved;

export const isAvailable = (): boolean => Boolean(ffmpegPath && fs.existsSync(ffmpegPath));
