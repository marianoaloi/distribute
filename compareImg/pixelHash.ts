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
    // Coarse bucketing key derived from baseGrey - see blurMd5For.
    baseMd5Blur: string;
}

// ---------------------------------------------------------------------------
// baseMd5Blur: the coarse "is it even worth comparing these two?" key.
//
// duplicateFinder.ts used to compare every frame against every other frame
// (O(n^2) over baseGrey). With ~2000 images + ~1000 videos/gifs at 4 frames
// each that is ~6000 rows -> ~18M mean-pixel-difference calls of 1600 bytes,
// which is the stage that stopped scaling. baseMd5Blur lets it group rows
// by an exact-equality key first (a Map lookup, O(n)) and only run the fine
// pixel comparison inside each group.
//
// Why not just md5 the blurred 40x40? An md5 changes completely when a
// single pixel moves by one level, and a JPEG re-encode or re-scaled
// re-upload moves nearly every pixel by a little. Blur alone never made two
// near-duplicates hash equal - that is exactly what the pairwise pixel
// comparison replaced (see duplicateFinder.ts). For the hash to be "common"
// across near-duplicates it has to throw away nearly all of the precision:
//   1. Gaussian-approximate blur (3 box passes, radius BLUR_RADIUS) so
//      per-pixel noise averages out;
//   2. area-average down to a BLUR_GRID x BLUR_GRID grid of cells;
//   3. quantise each cell to BLUR_LEVELS brightness bands.
// The md5 is taken over those BLUR_GRID^2 band indices. Two frames that the
// fine filter would accept (mean difference <= MEAN_DIFF_THRESHOLD) end up
// with cells that differ by roughly that much, so they land in the same
// band unless a cell happens to sit within a few levels of a band edge -
// the only way a real duplicate can be missed by this stage. Wider bands
// and fewer cells make that rarer at the cost of larger groups (more work
// for the fine filter); 4x4 cells in 4 bands is the balance chosen.
//
// Bump HashStore's FINGERPRINT_VERSION if anything here changes the
// produced key (it is derived data, but a mix of old and new keys across
// rows would silently split real duplicate groups).
const BLUR_RADIUS = 4;
const BLUR_GRID = 4;
const BLUR_LEVELS = 4;

// Sliding-window box blur pass: O(length) regardless of radius, since each
// step adjusts the running sum instead of re-summing the whole window.
// Edge pixels clamp to the nearest valid index (replicate at the border).
const boxBlur1D = (
    src: Uint8Array,
    outerCount: number,
    innerCount: number,
    radius: number,
    indexFor: (outer: number, inner: number) => number,
): Uint8Array => {
    const out = new Uint8Array(src.length);
    const windowSize = radius * 2 + 1;
    for (let outer = 0; outer < outerCount; outer++) {
        let sum = 0;
        for (let d = -radius; d <= radius; d++) {
            const inner = Math.min(innerCount - 1, Math.max(0, d));
            sum += src[indexFor(outer, inner)];
        }
        for (let inner = 0; inner < innerCount; inner++) {
            out[indexFor(outer, inner)] = Math.round(sum / windowSize);
            const addInner = Math.min(innerCount - 1, inner + radius + 1);
            const subInner = Math.max(0, inner - radius);
            sum += src[indexFor(outer, addInner)] - src[indexFor(outer, subInner)];
        }
    }
    return out;
};

const boxBlurHorizontal = (src: Uint8Array, width: number, height: number, radius: number): Uint8Array =>
    boxBlur1D(src, height, width, radius, (y, x) => y * width + x);

const boxBlurVertical = (src: Uint8Array, width: number, height: number, radius: number): Uint8Array =>
    boxBlur1D(src, width, height, radius, (x, y) => y * width + x);

// Cheap Gaussian approximation (3 box-blur passes, a standard technique) at
// O(width*height) regardless of radius - sub-millisecond on a 40x40 frame.
// The exact kernel shape doesn't matter: the result is only ever used as a
// consistent internal fingerprint, never rendered to the user. Also used by
// imageTransform.ts (debug tooling) so both blur the same way.
export const boxBlur = (src: Uint8Array, width: number, height: number, radius: number): Uint8Array => {
    let buf = src;
    for (let pass = 0; pass < 3; pass++) {
        buf = boxBlurHorizontal(buf, width, height, radius);
        buf = boxBlurVertical(buf, width, height, radius);
    }
    return buf;
};

// grey: a single-channel square frame of side `side` (baseGrey, 40x40).
// Returns the md5 of its blurred, downsampled, quantised form - see the
// comment block above for why each step is there.
export const blurMd5For = (grey: Uint8Array, side: number = GREY_SIDE): string => {
    if (grey.length !== side * side) {
        throw new Error(`blurMd5For: expected ${side * side} bytes for a ${side}x${side} frame, got ${grey.length}`);
    }
    const blurred = boxBlur(grey, side, side, BLUR_RADIUS);
    const cells = new Uint8Array(BLUR_GRID * BLUR_GRID);
    const bandWidth = 256 / BLUR_LEVELS;
    for (let cy = 0; cy < BLUR_GRID; cy++) {
        // Integer cell bounds so every source pixel lands in exactly one
        // cell even when side isn't a multiple of BLUR_GRID.
        const y0 = Math.floor((cy * side) / BLUR_GRID);
        const y1 = Math.floor(((cy + 1) * side) / BLUR_GRID);
        for (let cx = 0; cx < BLUR_GRID; cx++) {
            const x0 = Math.floor((cx * side) / BLUR_GRID);
            const x1 = Math.floor(((cx + 1) * side) / BLUR_GRID);
            let sum = 0;
            for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) sum += blurred[y * side + x];
            }
            const mean = sum / ((y1 - y0) * (x1 - x0));
            cells[cy * BLUR_GRID + cx] = Math.min(BLUR_LEVELS - 1, Math.floor(mean / bandWidth));
        }
    }
    return crypto.createHash("md5").update(cells).digest("hex");
};

// input: path to a still image (for video, the already-extracted frame file).
export const pixelHashFor = (input: string): Promise<PixelHash> => new Promise((resolve, reject) => {
    if (!ffmpegPath) {
        reject(new Error(`Cannot fingerprint ${input}: ffmpeg binary unavailable`));
        return;
    }
    console.log(`compareImg: fingerprinting ${input}`);
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
            resolve({
                baseMd5: crypto.createHash("md5").update(stdout).digest("hex"),
                baseGrey: stdout,
                baseMd5Blur: blurMd5For(stdout),
            });
        },
    );
});
