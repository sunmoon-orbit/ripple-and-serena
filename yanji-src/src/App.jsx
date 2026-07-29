import { useState, useEffect, useRef } from 'react'
import { useStore } from './store'
import { pushNative } from './utils/nativeInbox'
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
  const fromNativeRef = useRef(false)

  // 原生壳送文字进来的两个入口（通知栏快捷回复 / 系统分享）。
  // 挂在 App 上而不是 Chat 上：Chat 只在 activePanel==='chat' 时才挂载，
  // 而这两件事随时可能发生。这里负责把她带到对话页，正文交给队列。
  useEffect(() => {
    const enter = (kind) => (text) => {
      if (!text) return
      fromNativeRef.current = true
      setShowSplash(false)
      setShowHome(false)          // 她已经在通知里说了话，别再拦一道进入页
      useStore.setState({ activePanel: 'chat' })
      pushNative({ kind, text })
    }
    window.__yanjiQuickReply = enter('send')   // 通知栏回复：直接发出去
    window.__yanjiShareText = enter('draft')   // 系统分享：填进输入框，等她补一句
    // 原生来电页/通知上按了「接听」：她已经按过一次了，进来别再让她按第二次。
    // 这里只负责把她带到对话页，真正接起来的动作在 Chat 里（它才有 incomingCall）。
    window.__yanjiAnswerCall = () => {
      fromNativeRef.current = true
      setShowSplash(false)
      setShowHome(false)
      useStore.setState({ activePanel: 'chat' })
      // Chat 可能还没挂载完，事件会丢——所以同时留一个时间戳，Chat 挂上后自己去看
      window.__yanjiAnswerCallAt = Date.now()
      window.dispatchEvent(new Event('yanji-answer-call'))
    }
  }, [])

  useEffect(() => {
    // 官端槽位已被沉思替换（0723）：老存档里残留 guanduan 的自动迁到 chensi
    const t0 = theme === 'guanduan' ? 'chensi' : theme
    const t = t0 && t0 !== 'default' ? t0 : ''
    document.documentElement.setAttribute('data-theme', t)
    if (theme === 'glass') {
      const a = glassOpacity ?? 0.3
      document.documentElement.style.setProperty('--bubble-user-bg', `rgba(126,184,200,${a})`)
      document.documentElement.style.setProperty('--bubble-asst-bg', `rgba(255,255,255,${a})`)
    } else {
      document.documentElement.style.removeProperty('--bubble-user-bg')
      document.documentElement.style.removeProperty('--bubble-asst-bg')
    }
    try { window.YanjiNative?.updateTheme(theme || 'default') } catch {}
  }, [theme, glassOpacity])

  useEffect(() => {
    document.documentElement.style.setProperty('--avatar-size', `${avatarSize}px`)
  }, [avatarSize])

  return (
    <>
      {/* 开屏动画的定时器跑完会把进入页推上来——从通知栏进来的那次要跳过，
          否则刚被送进对话页又被盖回去 */}
      {showSplash && <Splash onDone={() => { setShowSplash(false); setShowHome(!fromNativeRef.current) }} />}
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
