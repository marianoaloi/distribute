interface Window {
    electron: {
        ipcRenderer: IpRenderer;
    };
}

interface IpRenderer {
    send: (channel: string, data: any) => void;
    on: (channel: string, func: (...args: any[]) => void) => void;
    once: (channel: string, func: (...args: any[]) => void) => void;
}