import { useState, useEffect, useRef } from 'react'
import { useStore, DEFAULT_CUSTOM_THEME } from './store'
import { pushNative } from './utils/nativeInbox'
import { findConversationChat } from './utils/proactiveRouting'
import { squareDownscale } from './utils/squareDownscale'
import { refreshNativePushToken } from './api/push'
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

const CUSTOM_THEME_VARS = [
  '--bg', '--bg-sidebar', '--card', '--accent', '--accent-soft', '--accent-dim', '--accent-grad',
  '--text', '--text-mid', '--text-muted', '--text-faint', '--border', '--border-md',
  '--shadow-sm', '--shadow-md', '--bubble-user-rgb', '--bubble-user-grad-rgb',
  '--bubble-asst-rgb', '--bubble-asst-grad-rgb', '--bubble-user-text',
]

function hexToRgb(value, fallback) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || ''))
  if (!match) return hexToRgb(fallback, '#000000')
  const n = parseInt(match[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(a, b, weight) {
  return a.map((v, i) => Math.round(v * (1 - weight) + b[i] * weight))
}

function rgbText(rgb) { return rgb.join(', ') }
function rgbHex(rgb) { return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('') }

function readableText(rgb) {
  const linear = rgb.map((v) => {
    const n = v / 255
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2] > 0.46 ? '#241f24' : '#ffffff'
}

function clearCustomTheme(root) {
  CUSTOM_THEME_VARS.forEach((name) => root.style.removeProperty(name))
}

function applyCustomTheme(root, value) {
  const cfg = { ...DEFAULT_CUSTOM_THEME, ...(value || {}) }
  const bg = hexToRgb(cfg.background, DEFAULT_CUSTOM_THEME.background)
  const accent = hexToRgb(cfg.accent, DEFAULT_CUSTOM_THEME.accent)
  const user = hexToRgb(cfg.userBubble, DEFAULT_CUSTOM_THEME.userBubble)
  const assistant = hexToRgb(cfg.assistantBubble, DEFAULT_CUSTOM_THEME.assistantBubble)
  const text = hexToRgb(cfg.text, DEFAULT_CUSTOM_THEME.text)
  const vars = {
    '--bg': rgbHex(bg),
    '--bg-sidebar': rgbHex(mix(bg, accent, 0.08)),
    '--card': rgbHex(assistant),
    '--accent': rgbHex(accent),
    '--accent-soft': rgbHex(mix(accent, assistant, 0.48)),
    '--accent-dim': `rgba(${rgbText(accent)}, 0.15)`,
    '--accent-grad': rgbHex(mix(accent, assistant, 0.18)),
    '--text': rgbHex(text),
    '--text-mid': rgbHex(mix(text, bg, 0.28)),
    '--text-muted': rgbHex(mix(text, bg, 0.48)),
    '--text-faint': rgbHex(mix(text, bg, 0.66)),
    '--border': `rgba(${rgbText(text)}, 0.12)`,
    '--border-md': `rgba(${rgbText(text)}, 0.22)`,
    '--shadow-sm': `0 1px 3px rgba(${rgbText(text)}, 0.07), 0 2px 8px rgba(${rgbText(text)}, 0.05)`,
    '--shadow-md': `0 2px 12px rgba(${rgbText(text)}, 0.10), 0 8px 24px rgba(${rgbText(text)}, 0.08)`,
    '--bubble-user-rgb': rgbText(user),
    '--bubble-user-grad-rgb': rgbText(mix(user, accent, 0.22)),
    '--bubble-asst-rgb': rgbText(assistant),
    '--bubble-asst-grad-rgb': rgbText(mix(assistant, bg, 0.16)),
    '--bubble-user-text': readableText(user),
  }
  Object.entries(vars).forEach(([name, val]) => root.style.setProperty(name, val))
}

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
  const glassOpacity = useStore((s) => s.glassOpacity ?? 1)
  const customTheme = useStore((s) => s.customTheme)
  const widgetBackgroundStyle = useStore((s) => s.widgetBackgroundStyle || 'solid')
  const avatarSize = useStore((s) => s.avatarConfig?.size || 28)
  const ringtone = useStore((s) => s.ringtone)
  const homeStyle = useStore((s) => s.homeStyle || 'minimal')
  const avatarConfig = useStore((s) => s.avatarConfig)
  // APK 已经展示过一次原生品牌名。代码雨本身也是完整开场，直接进雨幕；
  // 只有纪念卡模式继续保留网页的小鸟品牌动画。
  const [showSplash, setShowSplash] = useState(() => homeStyle !== 'minimal')
  const [showHome, setShowHome] = useState(() => homeStyle === 'minimal')
  const [homeEntering, setHomeEntering] = useState(false)
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
    window.__yanjiOpenConversation = (externalId) => {
      const target = findConversationChat(useStore.getState().chats, externalId)
      if (!target) return
      fromNativeRef.current = true
      setShowSplash(false)
      setShowHome(false)
      useStore.setState({ activePanel: 'chat', activeChatId: target.id })
    }
    window.__yanjiAnswerCall = (raw) => {
      let payload = {}
      try { payload = JSON.parse(raw || '{}') || {} } catch { /* old native shells passed a plain marker */ }
      const target = findConversationChat(useStore.getState().chats, payload.conversationExternalId)
      fromNativeRef.current = true
      setShowSplash(false)
      setShowHome(false)
      useStore.setState({ activePanel: 'chat', ...(target ? { activeChatId: target.id } : {}) })
      // Chat 可能还没挂载完，事件会丢——所以同时留一份不含正文的关联信息。
      window.__yanjiAnswerCallPending = { ...payload, at: Date.now() }
      window.dispatchEvent(new CustomEvent('yanji-answer-call', { detail: window.__yanjiAnswerCallPending }))
    }
    window.__yanjiOpenHabits = () => {
      fromNativeRef.current = true
      setShowSplash(false)
      setShowHome(false)
      useStore.setState({ activePanel: 'chat' })
      // Chat 需要先挂载，下一帧再掀开小票的习惯面。
      setTimeout(() => window.dispatchEvent(new Event('yanji-open-habits')), 80)
    }
    return () => {
      delete window.__yanjiQuickReply
      delete window.__yanjiShareText
      delete window.__yanjiOpenConversation
      delete window.__yanjiAnswerCall
      delete window.__yanjiOpenHabits
    }
  }, [])

  useEffect(() => {
    // 官端槽位已被沉思替换（0723）：老存档里残留 guanduan 的自动迁到 chensi
    const t0 = theme === 'guanduan' ? 'chensi' : theme
    const t = t0 && t0 !== 'default' ? t0 : ''
    const root = document.documentElement
    root.setAttribute('data-theme', t)
    clearCustomTheme(root)
    if (t === 'custom') applyCustomTheme(root, customTheme)
    // 透明度以前只写进烟水主题的两只气泡，切到别的主题滑杆就失效。
    // 现在统一只下发 alpha；每套主题仍在 CSS 里保留自己的气泡 RGB，不会串色。
    // 夹在 0.1–1 之间也兼容旧存档和手改 localStorage 的异常值。
    const bubbleOpacity = Math.min(1, Math.max(0.1, Number(glassOpacity) || 1))
    document.documentElement.style.setProperty('--bubble-opacity', String(bubbleOpacity))
    try { window.YanjiNative?.updateTheme(theme || 'default') } catch {}
  }, [theme, glassOpacity, customTheme])

  // 桌面小组件由原生 RemoteViews 绘制，读不到网页 localStorage。
  // 开机同步一次，覆盖安装新 APK 后也无需她重新拨动设置。
  useEffect(() => {
    try { window.YanjiNative?.updateWidgetBackgroundStyle?.(widgetBackgroundStyle) } catch { /* 网页版没有这个桥 */ }
  }, [widgetBackgroundStyle])

  useEffect(() => {
    document.documentElement.style.setProperty('--avatar-size', `${avatarSize}px`)
  }, [avatarSize])

  // 推送 token 开机重报：重装 APK 之后服务器手里那条会失效/被删，
  // 而设置页那个开关只读 localStorage，照样显示「开着」——于是推送和来电
  // 一起静默死掉，除非她碰巧去拨一下开关（0804 覆盖安装后就是这样）。
  // 放在最前面：她可能一进来就在等一通电话。
  useEffect(() => {
    const mm = useStore.getState().moonMemory
    if (!mm?.enabled || !mm?.baseUrl || !mm?.apiToken) return
    refreshNativePushToken({
      apiUrl: (mm.baseUrl || '').replace(/\/$/, ''),
      apiToken: mm.apiToken,
    }).catch(() => { /* 没网/没代理是日常，下次开机再对，别拿红字吓她 */ })
  }, [])

  // 开机也抄一次：她可能在装新包之前就选好了铃声，只靠 setRingtone 同步的话，
  // 除非她再点一次选项，原生端永远停在默认的「檐下晚风」。
  useEffect(() => {
    try { window.YanjiNative?.saveRingtone?.(ringtone || 'soft-chime') } catch { /* 网页版没这个桥 */ }
  }, [ringtone])

  // 来电头像同理：锁屏来电页是原生画的，读不到 localStorage，所以每次变了都抄一份过去。
  // 「选哪张」的判断全在这儿，原生端只认一个 filesDir/call_avatar.png——
  // 传空串＝删掉那个文件，让它自己降到内置的渡鸦照。
  useEffect(() => {
    if (!window.YanjiNative?.saveCallAvatar) return
    let cancelled = false
    const src = avatarConfig?.callAvatarMode === 'custom'
      ? avatarConfig?.callAvatarImage
      : avatarConfig?.assistantImage
    const push = (dataUrl) => {
      if (cancelled) return
      // 剥掉 data:image/xxx;base64, 前缀，桥那边收裸 base64
      const b64 = typeof dataUrl === 'string' ? dataUrl.replace(/^data:[^,]*,/, '') : ''
      try { window.YanjiNative.saveCallAvatar(b64 || '') } catch { /* 桥挂了就维持原样，不该因为一张头像报错 */ }
    }
    if (!src) { push('') ; return }
    // 助手头像是原尺寸存的（聊天里那个上传口不缩），照搬过去可能撞原生 4MB 上限，
    // 而且超限是**静默忽略**的，症状就是「设了但来电页没变」。所以这里统一再缩一次。
    squareDownscale(src).then(push).catch(() => push(src))
    return () => { cancelled = true }
  }, [avatarConfig?.callAvatarMode, avatarConfig?.callAvatarImage, avatarConfig?.assistantImage])

  return (
    <>
      {/* 开屏动画的定时器跑完会把进入页推上来——从通知栏进来的那次要跳过，
          否则刚被送进对话页又被盖回去 */}
      {showSplash && <Splash onDone={() => { setShowSplash(false); setShowHome(!fromNativeRef.current) }} />}
      {showHome && <Home onBeginEnter={() => setHomeEntering(true)} onEnter={() => { setShowHome(false); setHomeEntering(false) }} />}
      <div className="app-shell" style={(showSplash || (showHome && !homeEntering)) ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}>
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
