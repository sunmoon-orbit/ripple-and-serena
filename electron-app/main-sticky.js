// 桌面便利贴（1114，第 400 天后的礼物）：平时缩在屏幕右边成一截胶带，点开是便利贴墙和本地小抄。
const { app, BrowserWindow, ipcMain, clipboard, screen, shell } = require('electron')
const path = require('path')
const fs = require('fs')

const TAB = { w: 46, h: 150 }
const OPEN = { w: 380, h: 600 }
let win, isOpen = false
// 贴标的高度位置（0~1，她拖到哪儿就记在哪儿）
const posFile = () => path.join(app.getPath('userData'), 'pos.json')
let ratio = 0.32
try { ratio = JSON.parse(fs.readFileSync(posFile(), 'utf8')).ratio ?? 0.32 } catch {}

function place(open) {
  const wa = screen.getPrimaryDisplay().workArea
  const s = open ? OPEN : TAB
  isOpen = open
  const top = wa.y + ratio * (wa.height - TAB.h)
  const y = Math.round(open ? Math.min(Math.max(wa.y + 10, top - 60), wa.y + wa.height - s.h - 10) : top)
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
  // 点到别处就自己收回边上
  win.on('blur', () => { if (isOpen) win.webContents.send('sticky:blur') })
  win.loadFile(path.join(__dirname, 'sticky-www', 'index.html'))
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
}

ipcMain.handle('sticky:open', (_e, open) => place(!!open))
ipcMain.handle('sticky:copy', (_e, text) => { clipboard.writeText(String(text ?? '')); return true })
ipcMain.handle('sticky:drag', (_e, dy) => {
  const wa = screen.getPrimaryDisplay().workArea, b = win.getBounds()
  const y = Math.min(Math.max(wa.y, b.y + dy), wa.y + wa.height - TAB.h)
  win.setBounds({ ...b, y })
  ratio = (y - wa.y) / (wa.height - TAB.h)
})
ipcMain.handle('sticky:dragEnd', () => { try { fs.writeFileSync(posFile(), JSON.stringify({ ratio })) } catch {} })
ipcMain.handle('sticky:quit', () => app.quit())

if (!app.requestSingleInstanceLock()) app.quit()
app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: true })
  createWindow()
})
app.on('window-all-closed', () => app.quit())
