import { useState, useEffect } from 'react'
import { useStore } from './store'
import IconNav from './components/IconNav'
import Chat from './components/Chat'
import Memory from './components/Memory'
import Dream from './components/Dream'
import Moments from './components/Moments'
import Settings from './components/Settings'
import Home from './components/Home'
import Roost from './components/Roost'
import Toast from './components/Toast'
import MiniPlayer from './components/Chat/MiniPlayer'

function Splash({ onDone }) {
  const [fading, setFading] = useState(false)
  useEffect(() => {
    const t1 = setTimeout(() => setFading(true), 1400)
    const t2 = setTimeout(onDone, 1900)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])
  return (
    <div className={'splash' + (fading ? ' fade-out' : '')}>
      <svg className="splash-bird" width="72" height="72" viewBox="0 0 64 64" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path className="splash-path" d="M8 40 C8 40 14 18 32 16 C44 14 52 22 50 34 C48 46 38 52 26 48" strokeDasharray="200" />
        <path className="splash-path" d="M50 34 L60 28 L54 38" style={{ animationDelay: '0.3s' }} strokeDasharray="200" />
        <path className="splash-path" d="M26 48 L22 58" style={{ animationDelay: '0.5s' }} strokeDasharray="80" />
        <path className="splash-path" d="M32 48 L30 58" style={{ animationDelay: '0.55s' }} strokeDasharray="80" />
        <circle cx="42" cy="22" r="2" fill="var(--accent)" stroke="none" style={{ opacity: 0, animation: 'splashFadeIn 0.3s ease 0.7s forwards' }} />
        <path className="splash-path" d="M8 40 L2 38" style={{ animationDelay: '0.6s' }} strokeDasharray="40" />
      </svg>
      <span className="splash-label">言叽</span>
    </div>
  )
}

export default function App() {
  const activePanel = useStore((s) => s.activePanel)
  const theme = useStore((s) => s.theme)
  const glassOpacity = useStore((s) => s.glassOpacity ?? 0.3)
  const avatarSize = useStore((s) => s.avatarConfig?.size || 28)
  const [showSplash, setShowSplash] = useState(true)
  const [showHome, setShowHome] = useState(false)

  useEffect(() => {
    const t = theme && theme !== 'default' ? theme : ''
    document.documentElement.setAttribute('data-theme', t)
    if (theme === 'glass') {
      const a = glassOpacity ?? 0.3
      document.documentElement.style.setProperty('--bubble-user-bg', `rgba(126,184,200,${a})`)
      document.documentElement.style.setProperty('--bubble-asst-bg', `rgba(255,255,255,${a})`)
    } else {
      document.documentElement.style.removeProperty('--bubble-user-bg')
      document.documentElement.style.removeProperty('--bubble-asst-bg')
    }
  }, [theme, glassOpacity])

  useEffect(() => {
    document.documentElement.style.setProperty('--avatar-size', `${avatarSize}px`)
  }, [avatarSize])

  return (
    <>
      {showSplash && <Splash onDone={() => { setShowSplash(false); setShowHome(true) }} />}
      {showHome && <Home onEnter={() => setShowHome(false)} />}
      <div className="app-shell" style={(showSplash || showHome) ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}>
        <IconNav />
        <div className="main-area">
          {activePanel === 'roost' && <Roost />}
          {activePanel === 'chat' && <Chat />}
          {activePanel === 'memory' && <Memory />}
          {activePanel === 'dream' && <Dream />}
          {activePanel === 'moments' && <Moments />}
          {activePanel === 'settings' && <Settings />}
        </div>
        <Toast />
        <MiniPlayer />
      </div>
    </>
  )
}
