const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('sticky', {
  open: v => ipcRenderer.invoke('sticky:open', v),
  copy: t => ipcRenderer.invoke('sticky:copy', t),
  quit: () => ipcRenderer.invoke('sticky:quit'),
})
