// Import the necessary Electron components.
const { contextBridge, ipcRenderer } = require('electron');

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
            'findDuplicates',
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
        ]
    }
};

// Exposed protected methods in the render process.
contextBridge.exposeInMainWorld(
    // Allowed 'ipcRenderer' methods.
    'electron', {
    ipcRenderer: {
        // From render to main.
        send: (channel, args) => {
            let validChannels = ipc.render.send;
            if (validChannels.includes(channel)) {
                ipcRenderer.send(channel, args);
            }
        },
        // From main to render.
        receive: (channel, listener) => {
            let validChannels = ipc.render.receive;
            if (validChannels.includes(channel)) {
                // Deliberately strip event as it includes `sender`.
                ipcRenderer.on(channel, listener);
            }
        },
        // From render to main and back again.
        invoke: (channel, args) => {
            let validChannels = ipc.render.sendReceive;
            if (validChannels.includes(channel)) {
                return ipcRenderer.invoke(channel, args);
            }
        },
        on: (channel, listener) => {
            let validChannels = ipc.render.sendReceive;
            if (validChannels.includes(channel)) {
                ipcRenderer.on(channel, listener);
            }
        },
        once: (channel, listener) => {
            let validChannels = ipc.render.sendReceive;
            if (validChannels.includes(channel)) {
                ipcRenderer.once(channel, listener);
            }
        },
        removeAllListeners: (channel) => {
            let validChannels = [...ipc.render.send, ...ipc.render.receive, ...ipc.render.sendReceive];
            if (validChannels.includes(channel)) {
                ipcRenderer.removeAllListeners(channel);
            }
        }
    }
}
);