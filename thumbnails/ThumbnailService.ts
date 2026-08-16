import path from "path";
import fs from "fs";
import * as cache from "./cache";
import { getPlaceholderPath } from "./providers/placeholder";
import ffmpegStaticProvider from "./providers/ffmpegStatic";

import type { ThumbnailProvider } from "../types/domain";

const providers: ThumbnailProvider[] = [
    ffmpegStaticProvider,
];

let selected: ThumbnailProvider | null | undefined;
const getProvider = (): ThumbnailProvider | null => {
    if (selected === undefined) {
        selected = providers.find((p) => p.isAvailable()) || null;
        console.log("Thumbnail provider:", selected ? selected.name : "none (placeholder only)");
    }
    return selected;
};

// Some filenames break the encoder: retry through a hard link with a safe name
const linkPathFor = (input: string): string => path.join(cache.getLinkDir(), cache.hashFor(input) + path.extname(input));

const withLinkRetrySync = (provider: ThumbnailProvider, input: string, output: string): void => {
    try {
        provider.generateSync(input, output);
    } catch {
        const tmp = linkPathFor(input);
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        fs.linkSync(input, tmp);
        try {
            provider.generateSync(tmp, output);
        } finally {
            fs.unlinkSync(tmp);
        }
    }
};

const withLinkRetry = async (provider: ThumbnailProvider, input: string, output: string): Promise<void> => {
    try {
        await provider.generate(input, output);
    } catch {
        const tmp = linkPathFor(input);
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        fs.linkSync(input, tmp);
        try {
            await provider.generate(tmp, output);
        } finally {
            fs.unlinkSync(tmp);
        }
    }
};

// Never throws: always resolves to a path the renderer can display
export const getThumbnailSync = (videoPath: string, contentMd5?: string | null): string => {
    const output = cache.thumbnailPathFor(videoPath, contentMd5);
    if (fs.existsSync(output)) return output;
    const provider = getProvider();
    if (provider) {
        try {
            cache.ensureCacheDir();
            withLinkRetrySync(provider, videoPath, output);
            if (fs.existsSync(output)) return output;
        } catch (error) {
            console.error("Thumbnail failed for", videoPath, "-", (error as Error).message);
        }
    }
    return getPlaceholderPath();
};

export const getThumbnail = async (videoPath: string, contentMd5?: string | null): Promise<string> => {
    const output = cache.thumbnailPathFor(videoPath, contentMd5);
    if (fs.existsSync(output)) return output;
    const provider = getProvider();
    if (provider) {
        try {
            cache.ensureCacheDir();
            await withLinkRetry(provider, videoPath, output);
            if (fs.existsSync(output)) return output;
        } catch (error) {
            console.error("Thumbnail failed for", videoPath, "-", (error as Error).message);
        }
    }
    return getPlaceholderPath();
};

export const ensureCacheDir = cache.ensureCacheDir;
