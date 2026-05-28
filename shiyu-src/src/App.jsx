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
  { id: 'memory', label: '记忆', Icon: NotebookPen },
  { id: 'stats', label: '纪念', Icon: Sparkles },
  { id: 'trash', label: '回收站', Icon: Trash2 },
  { id: 'settings', label: '设置', Icon: SettingsIcon },
]

export default function App() {
  const theme = useStore((s) => s.theme)
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const [splash, setSplash] = useState(true)
  const [unlocked, setUnlocked] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
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
            <span>{label}</span>
            <span className="nav-dot" />
          </button>
        ))}
      </nav>

      <ToastHost />
    </div>
  )
}
