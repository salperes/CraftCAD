// Preload bridge: exposes native file dialogs and the bundled ODA installer to the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('craftcadDesktop', {
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  saveDialog: (name, ext, label) => ipcRenderer.invoke('save-dialog', { name, ext, label }),
  writeFile: (path, bytes) => ipcRenderer.invoke('write-file', path, bytes),
  odaBundled: () => ipcRenderer.invoke('oda-bundled'),
  installOda: () => ipcRenderer.invoke('install-oda'),
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, f) => cb(f)),
});
