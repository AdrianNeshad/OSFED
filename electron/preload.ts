export {};
const { contextBridge, ipcRenderer } = require('electron');

type Unsub = () => void;

const api = {
  // Engine JSON-RPC
  call: (method: string, params: any = {}) => ipcRenderer.invoke('engine:call', method, params),
  onEngineNotification: (cb: (n: { method: string; params: any }) => void): Unsub => {
    const listener = (_e: any, n: any) => cb(n);
    ipcRenderer.on('engine:notification', listener);
    return () => ipcRenderer.removeListener('engine:notification', listener);
  },

  // libimobiledevice
  checkTools: () => ipcRenderer.invoke('imobile:check'),
  listDevices: () => ipcRenderer.invoke('imobile:listDevices'),
  pair: (udid: string) => ipcRenderer.invoke('imobile:pair', udid),
  defaultBackupTarget: () => ipcRenderer.invoke('imobile:defaultBackupTarget'),
  startBackup: (args: { udid: string; targetDir: string; password: string }) =>
    ipcRenderer.invoke('imobile:startBackup', args),
  cancelBackup: () => ipcRenderer.invoke('imobile:cancelBackup'),
  onBackupEvent: (cb: (ev: any) => void): Unsub => {
    const listener = (_e: any, ev: any) => cb(ev);
    ipcRenderer.on('imobile:backupEvent', listener);
    return () => ipcRenderer.removeListener('imobile:backupEvent', listener);
  },

  // dialogs / shell / paths
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  selectSaveFolder: () => ipcRenderer.invoke('dialog:selectSaveFolder'),
  saveFile: (defaultName: string) => ipcRenderer.invoke('dialog:saveFile', defaultName),
  openPath: (p: string) => ipcRenderer.invoke('shell:openPath', p),
  paths: () => ipcRenderer.invoke('app:paths'),
};

contextBridge.exposeInMainWorld('osfed', api);
