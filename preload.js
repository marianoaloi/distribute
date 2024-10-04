// Import the necessary Electron components.
const { contextBridge, ipcRenderer } = require('electron');

// White-listed channels.
const ipc = {
    'render': {
        // From render to main.
        'send': ['directoryOpen',
            'process',
            'verifyOpen',
            'open',
        ],
        // From main to render.
        'receive': ['directoryOpen',
            'process',
            'verifyOpen',
            'open',],
        // From render to main and back again.
        'sendReceive': [
            'directoryOpen',
            'process',
            'verifyOpen',
            'open', // Channel name
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
        }
    }
}
);