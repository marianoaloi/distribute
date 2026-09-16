import { Jimp } from "jimp";
import type { JimpInstance } from "jimp";
import crypto from "crypto";
import { boxBlur } from "./pixelHash";

// Spec: 68x68 square, crop a 4px border off every side down to 60x60, greyscale
const SQUARE_SIZE = 48;
const CROP_MARGIN = 4;
const FINAL_SIZE = SQUARE_SIZE - (CROP_MARGIN * 2);
const BLUR_LEVELS = [4]; //[1, 2, 4, 8, 16, 32, 64, 128]; // radius in pixels

const hashBuffer = (buffer: Buffer): string => crypto.createHash("md5").update(buffer).digest("hex");

// input: file path or Buffer
const toBaseImage = async (input: string | Buffer): Promise<JimpInstance> => {
    const image = await Jimp.read(input);
    image.resize({ w: SQUARE_SIZE, h: SQUARE_SIZE });
    image.crop({ x: CROP_MARGIN, y: CROP_MARGIN, w: FINAL_SIZE, h: FINAL_SIZE });
    image.greyscale();
    return image as JimpInstance;
};

// Pulls the greyscale intensity (R channel; R=G=B after greyscale()) out of
// Jimp's RGBA buffer into a flat single-channel array for blurring.
const greyscaleChannel = (image: JimpInstance): Uint8Array => {
    const { data, width, height } = image.bitmap;
    const out = new Uint8Array(width * height);
    for (let i = 0; i < out.length; i++) out[i] = data[i * 4];
    return out;
};

export interface Md5Result {
    baseMd5: string;
    blurMd5: string[];
}

// Base MD5 (of the transformed greyscale pixels) plus one MD5 per blur level
const md5sFor = async (input: string | Buffer): Promise<Md5Result> => {
    const base = await toBaseImage(input);
    const baseMd5 = hashBuffer(Buffer.from(base.bitmap.data));

    const { width, height } = base.bitmap;
    const grey = greyscaleChannel(base);
    const blurMd5 = BLUR_LEVELS.map(level => hashBuffer(Buffer.from(boxBlur(grey, width, height, level))));

    return { baseMd5, blurMd5 };
};

// NOTE: pixelsFor() used to live here and was the production entry point for
// items.baseMd5/baseGrey. It is gone - compareImg/pixelHash.ts produces both
// via ffmpeg without decoding the full-resolution image, which is ~20x
// faster and removed the worker pool that existed to survive Jimp's memory
// cost. What remains in this file is used only by
// scripts/debugCompareVideos.ts, which renders the intermediate images and
// so genuinely does want a real decode it can inspect.
export {
    md5sFor,
    BLUR_LEVELS,
    // Exposed for debug tooling (scripts/debugCompareVideos.js) so it can
    // render the actual images being hashed, not just the resulting md5s.
    toBaseImage,
    greyscaleChannel,
    // Lives in pixelHash.ts now (it produces items.baseMd5Blur there);
    // re-exported so this debug tooling blurs exactly the way production does.
    boxBlur,
    hashBuffer,
    SQUARE_SIZE,
    CROP_MARGIN,
    FINAL_SIZE,
};
