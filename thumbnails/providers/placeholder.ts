import path from "path";
import fs from "fs";
import { getCacheDir, ensureCacheDir } from "../cache";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200">
  <rect width="300" height="200" fill="#263238"/>
  <circle cx="150" cy="100" r="42" fill="#455a64"/>
  <polygon points="138,78 138,122 175,100" fill="#eceff1"/>
</svg>
`;

// Shared static image shown when no thumbnail can be generated
export const getPlaceholderPath = (): string => {
    const placeholderPath = path.join(getCacheDir(), "video-placeholder.svg");
    if (!fs.existsSync(placeholderPath)) {
        ensureCacheDir();
        fs.writeFileSync(placeholderPath, SVG, "utf8");
    }
    return placeholderPath;
};
