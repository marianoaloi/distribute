// Import the necessary Electron components.
import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

// Renderer-side listener signature varies by channel (each channel carries a
// different payload shape - see types/domain.ts's StreamMediaItem etc. on the
// main-process side) - `any[]` here is the generic pass-through boundary this
// preload script exists to provide, not a place that can be narrowed further.
type IpcListener = (event: IpcRendererEvent, ...args: unknown[]) => void;

// White-listed channels.
const ipc = {
    'render': {
        // From render to main.
        'send': ['directoryOpen',
            'loadMedias',
            'zoom',
            'menuOpen',
            'delete',
            'process',
            'verifyOpen',
            'openRecursive',
            'sort',
            'open',
            'findIndexDuplicates',
            'getDuplicateGroups',
            'rebuildIndex',
            'detectObjects',
            'stopDetection',
            'chooseOnnxModel',
            'exportDatabase',
            'importDatabase',
            'saveDetectionClasses',
            'loadDetectionClasses',
            'loadDetections',
            'getMediaFrames',
            'saveDetectionSize',
            'getDetectionSize',
        ],
        // From main to render.
        'receive': ['directoryOpen',
            'loadMedias',
            'zoom',
            'menuOpen',
            'delete',
            'process',
            'verifyOpen',
            'openRecursive',
            'sort',
            'open',
            'cleanGrid',
            'duplicatesFound',
            'mediaFramesFound',
        ],
        // From render to main and back again.
        'sendReceive': [
            'directoryOpen',
            'loadMedias',
            'zoom',
            'menuOpen',
            'delete',
            'process',
            'verifyOpen',
            'openRecursive',
            'sort',
            'open',
            "addOneMedia",
            'cleanGrid',
            'duplicatesFound',
            'indexRebuilt',
            'indexRebuildProgress',
            'mediaLoadStart',
            'mediaLoadComplete',
            'detectionFound',
            'detectionProgress',
            'detectionsComplete',
            'onnxModelChosen',
            'databaseExported',
            'databaseImported',
            'detectionClassesLoaded',
            'detectionsLoaded',
            'fileProcessed',
            'mediaFramesFound',
            'detectionSizeLoaded',
            'pipelineProgress',
            'pipelineFinished',
            'pipelineRejected',
        ]
    }
};

// Exposed protected methods in the render process.
contextBridge.exposeInMainWorld(
    // Allowed 'ipcRenderer' methods.
    'electron', {
    ipcRenderer: {
        // From render to main.
        send: (channel: string, args: unknown) => {
            const validChannels: string[] = ipc.render.send;
            if (validChannels.includes(channel)) {
                ipcRenderer.send(channel, args);
            }
        },
        // From main to render.
        receive: (channel: string, listener: IpcListener) => {
            const validChannels: string[] = ipc.render.receive;
            if (validChannels.includes(channel)) {
                // Deliberately strip event as it includes `sender`.
                ipcRenderer.on(channel, listener);
            }
        },
        // From render to main and back again.
        invoke: (channel: string, args: unknown) => {
            const validChannels: string[] = ipc.render.sendReceive;
            if (validChannels.includes(channel)) {
                return ipcRenderer.invoke(channel, args);
            }
        },
        on: (channel: string, listener: IpcListener) => {
            const validChannels: string[] = ipc.render.sendReceive;
            if (validChannels.includes(channel)) {
                ipcRenderer.on(channel, listener);
            }
        },
        once: (channel: string, listener: IpcListener) => {
            const validChannels: string[] = ipc.render.sendReceive;
            if (validChannels.includes(channel)) {
                ipcRenderer.once(channel, listener);
            }
        },
        removeAllListeners: (channel: string) => {
            const validChannels: string[] = [...ipc.render.send, ...ipc.render.receive, ...ipc.render.sendReceive];
            if (validChannels.includes(channel)) {
                ipcRenderer.removeAllListeners(channel);
            }
        }
    }
}
);
