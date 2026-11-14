const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('sticky', {
  open: v => ipcRenderer.invoke('sticky:open', v),
  copy: t => ipcRenderer.invoke('sticky:copy', t),
  drag: dy => ipcRenderer.invoke('sticky:drag', dy),
  dragEnd: () => ipcRenderer.invoke('sticky:dragEnd'),
  onBlur: fn => ipcRenderer.on('sticky:blur', fn),
  quit: () => ipcRenderer.invoke('sticky:quit'),
})
