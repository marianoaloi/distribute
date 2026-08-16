// Ambient declarations for the two dependencies that ship no types of their
// own and have no @types package on the registry. Everything else used by
// the Electron main process (jimp, onnxruntime-node, better-sqlite3 via
// @types/better-sqlite3, mime-types via @types/mime-types, electron, node)
// already has real types.

declare module "ffmpeg-static" {
    // The package's module.exports IS the resolved binary path (or null if
    // no prebuilt binary exists for this platform/arch).
    const ffmpegPath: string | null;
    export default ffmpegPath;
}

declare module "electron-devtools-installer" {
    export interface ExtensionReference {
        id: string;
        electron?: string;
    }

    export const REACT_DEVELOPER_TOOLS: ExtensionReference;
    export const REDUX_DEVTOOLS: ExtensionReference;

    export interface InstalledExtensionInfo {
        name: string;
        version: string;
    }

    export default function installExtension(
        extensionReference: ExtensionReference | ExtensionReference[]
    ): Promise<InstalledExtensionInfo[]>;
}
