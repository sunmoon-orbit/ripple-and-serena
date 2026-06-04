import { useState, useEffect } from 'react'
import { useStore } from './store'
import Splash from './components/Splash'
import PasswordGate from './components/PasswordGate'
import { ToastHost } from './components/Toast'
import MemoryPanel from './components/MemoryPanel'
import TrashPanel from './components/TrashPanel'
import StatsPanel from './components/StatsPanel'
import SettingsPanel from './components/SettingsPanel'
import { NotebookPen, Trash2, Sparkles, Settings as SettingsIcon } from 'lucide-react'

const NAV = [
  { id: 'memory', label: 'Rings', Icon: NotebookPen },
  { id: 'stats', label: 'Marks', Icon: Sparkles },
  { id: 'trash', label: 'Fossils', Icon: Trash2 },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
]

export default function App() {
  const theme = useStore((s) => s.theme)
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const [splash, setSplash] = useState(true)
  const [unlocked, setUnlocked] = useState(false)

  useEffect(() => {
    const bg = { light: '#ECEEF4', blossom: '#F9F0F3', midnight: '#080C14', dawn: '#F7F2EA' }
    const color = bg[theme] || bg.light
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.style.background = color
    const meta = document.getElementById('theme-color-meta')
    if (meta) meta.setAttribute('content', color)
  }, [theme])

  if (splash) return <Splash onDone={() => setSplash(false)} />
  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />

  return (
    <div className="app">
      {panel === 'memory' && <MemoryPanel />}
      {panel === 'stats' && <StatsPanel />}
      {panel === 'trash' && <TrashPanel />}
      {panel === 'settings' && <SettingsPanel />}

      <nav className="nav">
        {NAV.map(({ id, label, Icon }) => (
          <button key={id} className={'nav-item' + (panel === id ? ' active' : '')} onClick={() => setPanel(id)}>
            <Icon size={20} strokeWidth={2} />
            <span className="nav-label">{label}</span>
            <span className="nav-dot" />
          </button>
        ))}
      </nav>

      <ToastHost />
    </div>
  )
}
