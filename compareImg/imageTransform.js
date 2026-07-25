const { Jimp } = require("jimp");
const crypto = require("crypto");

// Spec: 68x68 square, crop a 4px border off every side down to 60x60, greyscale
const SQUARE_SIZE = 48;
const CROP_MARGIN = 4;
const FINAL_SIZE = SQUARE_SIZE - (CROP_MARGIN * 2);
const BLUR_LEVELS = [1, 2, 4, 8, 16, 32, 64, 128]; // radius in pixels

const hashBuffer = (buffer) => crypto.createHash("md5").update(buffer).digest("hex");

// input: file path or Buffer
const toBaseImage = async (input) => {
    const image = await Jimp.read(input);
    image.resize({ w: SQUARE_SIZE, h: SQUARE_SIZE });
    image.crop({ x: CROP_MARGIN, y: CROP_MARGIN, w: FINAL_SIZE, h: FINAL_SIZE });
    image.greyscale();
    return image;
};

// Pulls the greyscale intensity (R channel; R=G=B after greyscale()) out of
// Jimp's RGBA buffer into a flat single-channel array for blurring.
const greyscaleChannel = (image) => {
    const { data, width, height } = image.bitmap;
    const out = new Uint8Array(width * height);
    for (let i = 0; i < out.length; i++) out[i] = data[i * 4];
    return out;
};

// Sliding-window box blur pass: O(length) regardless of radius, since each
// step adjusts the running sum instead of re-summing the whole window.
// Edge pixels clamp to the nearest valid index (replicate at the border).
const boxBlur1D = (src, outerCount, innerCount, radius, indexFor) => {
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

const boxBlurHorizontal = (src, width, height, radius) =>
    boxBlur1D(src, height, width, radius, (y, x) => y * width + x);

const boxBlurVertical = (src, width, height, radius) =>
    boxBlur1D(src, width, height, radius, (x, y) => y * width + x);

// Cheap Gaussian approximation (3 box-blur passes, a standard technique) at
// O(width*height) regardless of radius. Jimp's own .gaussian(radius) is a
// naive convolution that cost 12+ seconds total across our 5 blur levels on
// a 60x60 image (6.5s alone at radius 50); this is sub-millisecond. The
// exact kernel shape doesn't matter - these blur levels are only ever used
// as consistent internal fingerprints, never rendered to the user.
const boxBlur = (src, width, height, radius) => {
    let buf = src;
    for (let pass = 0; pass < 3; pass++) {
        buf = boxBlurHorizontal(buf, width, height, radius);
        buf = boxBlurVertical(buf, width, height, radius);
    }
    return buf;
};

// Base MD5 (of the transformed greyscale pixels) plus one MD5 per blur level
const md5sFor = async (input) => {
    const base = await toBaseImage(input);
    const baseMd5 = hashBuffer(Buffer.from(base.bitmap.data));

    const { width, height } = base.bitmap;
    const grey = greyscaleChannel(base);
    const blurMd5 = BLUR_LEVELS.map(level => hashBuffer(Buffer.from(boxBlur(grey, width, height, level))));

    return { baseMd5, blurMd5 };
};

module.exports = {
    md5sFor,
    BLUR_LEVELS,
    // Exposed for debug tooling (scripts/debugCompareVideos.js) so it can
    // render the actual images being hashed, not just the resulting md5s.
    toBaseImage,
    greyscaleChannel,
    boxBlur,
    hashBuffer,
    SQUARE_SIZE,
    CROP_MARGIN,
    FINAL_SIZE,
};
