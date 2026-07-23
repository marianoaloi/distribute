const { modelCacheDir } = require("./cache");

// @xenova/transformers ships ESM-only ("type": "module"), so it's loaded via
// dynamic import() from this CommonJS module (same fix as the vectra/uuid issue).
let extractorPromise;

const getExtractor = () => {
    if (!extractorPromise) {
        extractorPromise = import("@xenova/transformers")
            .then(({ pipeline, env }) => {
                env.cacheDir = modelCacheDir;
                return pipeline("image-feature-extraction", "Xenova/clip-vit-base-patch32");
            });
    }
    return extractorPromise;
};

// input: file path or Buffer. Returns a plain number[] embedding vector.
const embed = async (input) => {
    const extractor = await getExtractor();
    const output = await extractor(input, { pooling: "mean", normalize: true });
    return Array.from(output.data);
};

module.exports = {
    embed,
};
