const { Jimp } = require("jimp");
const crypto = require("crypto");

// Spec: 68x68 square, crop a 4px border off every side down to 60x60, greyscale
const SQUARE_SIZE = 68;
const CROP_MARGIN = 4;
const FINAL_SIZE = SQUARE_SIZE - (CROP_MARGIN * 2);
const BLUR_LEVELS = [1, 12, 25, 38, 50];

const hashBuffer = (buffer) => crypto.createHash("md5").update(buffer).digest("hex");

// input: file path or Buffer
const toBaseImage = async (input) => {
    const image = await Jimp.read(input);
    image.resize({ w: SQUARE_SIZE, h: SQUARE_SIZE });
    image.crop({ x: CROP_MARGIN, y: CROP_MARGIN, w: FINAL_SIZE, h: FINAL_SIZE });
    image.greyscale();
    return image;
};

// Base MD5 (of the transformed greyscale pixels) plus one MD5 per blur level
const md5sFor = async (input) => {
    const base = await toBaseImage(input);
    const baseMd5 = hashBuffer(Buffer.from(base.bitmap.data));

    const blurMd5 = BLUR_LEVELS.map(level => {
        const blurred = base.clone().gaussian(level);
        return hashBuffer(Buffer.from(blurred.bitmap.data));
    });

    return { baseMd5, blurMd5 };
};

module.exports = {
    md5sFor,
    BLUR_LEVELS,
};
