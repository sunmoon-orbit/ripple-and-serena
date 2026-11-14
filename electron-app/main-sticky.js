// 桌面便利贴（1114，第 400 天后的礼物）：平时缩在屏幕右边成一截胶带，点开是便利贴墙和本地小抄。
const { app, BrowserWindow, ipcMain, clipboard, screen, shell } = require('electron')
const path = require('path')

const TAB = { w: 46, h: 150 }
const OPEN = { w: 380, h: 600 }
let win

function place(open) {
  const wa = screen.getPrimaryDisplay().workArea
  const s = open ? OPEN : TAB
  const y = Math.round(wa.y + (open ? Math.max(20, wa.height * 0.18) : wa.height * 0.32))
  win.setBounds({ x: wa.x + wa.width - s.w, y, width: s.w, height: s.h })
}

function createWindow() {
  win = new BrowserWindow({
    ...TAB,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: '便利贴',
    webPreferences: { preload: path.join(__dirname, 'preload-sticky.js'), contextIsolation: true, nodeIntegration: false },
  })
  win.setAlwaysOnTop(true, 'floating')
  place(false)
  win.loadFile(path.join(__dirname, 'sticky-www', 'index.html'))
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
}

ipcMain.handle('sticky:open', (_e, open) => place(!!open))
ipcMain.handle('sticky:copy', (_e, text) => { clipboard.writeText(String(text ?? '')); return true })
ipcMain.handle('sticky:quit', () => app.quit())

if (!app.requestSingleInstanceLock()) app.quit()
app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: true })
  createWindow()
})
app.on('window-all-closed', () => app.quit())
