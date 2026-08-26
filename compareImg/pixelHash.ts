import { execFile } from "child_process";
import crypto from "crypto";

import { ffmpegPath } from "./ffmpegBinary";

// Replaces the Jimp worker-thread pool (computePool.ts + frameWorker.ts,
// both deleted) that used to produce these two values.
//
// That pool existed entirely to manage the fallout of one decision: Jimp is
// a pure-JS decoder, so producing a 40x40 greyscale thumbnail meant decoding
// the FULL image to an RGBA bitmap first. On the 21MP frames that exposed
// this, that was ~717MB of peak RSS and ~1.5s of CPU *per image* - which in
// turn required a worker pool (to keep the main thread alive), memory-aware
// pool sizing (to stop concurrent decodes from swap-thrashing the machine),
// soft and hard timeouts, worker recycling, and an 11-attempt retry loop.
// Roughly 300 lines of machinery, all of it downstream of decoding 21
// megapixels to throw away all but 1600 of them.
//
// ffmpeg decodes JPEG at a reduced scale directly from the DCT coefficients,
// so the full-size bitmap is never materialised at all. The cost collapses
// from ~1.5s/717MB to ~70ms and a few MB, which removes the *reason* for
// every piece of that machinery rather than tuning it. Measured on the same
// 20 files: 12.9s through the old 8-worker pool (32.8s under memory
// pressure) vs 1.4s fully sequential here, 0.5s at concurrency 4.
//
// ffmpeg is not a new dependency - videoFrames.ts already shells out to the
// same binary to extract the video frames that get fingerprinted here.
const GREY_SIDE = 40;
const SQUARE_SIDE = 48;
const CROP_MARGIN = (SQUARE_SIDE - GREY_SIDE) / 2;
const GREY_BYTES = GREY_SIDE * GREY_SIDE;

// Squash to 48x48 ignoring aspect ratio, trim a 4px border off every side
// down to 40x40, and emit single-channel 8-bit grey - the same geometry the
// Jimp version produced, but done inside ffmpeg so no pixel arithmetic (and
// no RGBA-vs-BGRA channel-order guessing) happens in JS at all.
//
// flags=area matters at this scale factor: a 5616x3744 source is being
// reduced ~117x, and the default sampling filters read too few source
// pixels to be representative, which is what made the old Jimp output
// noticeably aliased. Area-averaging every source pixel into its
// destination cell is both the correct downscale and the more stable
// fingerprint.
const FILTER = `scale=${SQUARE_SIDE}:${SQUARE_SIDE}:flags=area`
    + `,crop=${GREY_SIDE}:${GREY_SIDE}:${CROP_MARGIN}:${CROP_MARGIN}`
    + `,format=gray`;

// A single bound, and Node's own execFile enforces it by killing the child -
// no timers to arm, clear or leak. This replaces the old soft/hard timeout
// pair, which only needed two tiers because a timeout there could not
// actually stop an in-process Jimp decode; an OS process can just be killed.
// Generous, since it now only has to cover genuinely pathological input
// rather than routine contention.
const TIMEOUT_MS = 30_000;

export interface PixelHash {
    // md5 of baseGrey. The Jimp version hashed the 40x40 RGBA buffer
    // instead, but that image had already been greyscaled, so R=G=B and
    // three quarters of what it hashed was duplicated data. Hashing the
    // grey bytes directly is the same fingerprint with none of the padding.
    baseMd5: string;
    // Raw 40x40 single-channel greyscale (1600 bytes), stored as-is in
    // items.baseGrey so duplicateFinder.ts can do a real mean-pixel-
    // difference comparison rather than hash equality.
    baseGrey: Buffer;
}

// input: path to a still image (for video, the already-extracted frame file).
export const pixelHashFor = (input: string): Promise<PixelHash> => new Promise((resolve, reject) => {
    if (!ffmpegPath) {
        reject(new Error(`Cannot fingerprint ${input}: ffmpeg binary unavailable`));
        return;
    }
    execFile(
        ffmpegPath,
        [
            "-loglevel", "error",
            "-i", input,
            "-vf", FILTER,
            // Guards against an animated source (a gif routed here, or a
            // multi-frame image) streaming more than the one frame we want.
            "-frames:v", "1",
            "-f", "rawvideo",
            "-pix_fmt", "gray",
            "-",
        ],
        // maxBuffer only has to hold GREY_BYTES; the allowance is slack for
        // an unexpectedly chatty stderr, not room for a real image.
        { encoding: "buffer", timeout: TIMEOUT_MS, maxBuffer: 1 << 20 },
        (error, stdout) => {
            if (error) {
                reject(new Error(`Fingerprinting failed for ${input}: ${error.message}`));
                return;
            }
            // A truncated or empty read means ffmpeg exited 0 without
            // producing the frame (some malformed inputs do exactly this).
            // Checked rather than trusted, so a short buffer becomes a
            // per-file error instead of a silently wrong hash in the DB.
            if (stdout.length !== GREY_BYTES) {
                reject(new Error(`Fingerprinting failed for ${input}: expected ${GREY_BYTES} bytes, got ${stdout.length}`));
                return;
            }
            resolve({ baseMd5: crypto.createHash("md5").update(stdout).digest("hex"), baseGrey: stdout });
        },
    );
});
