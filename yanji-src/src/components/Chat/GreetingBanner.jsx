import { useState, useEffect, useRef } from 'react'
import { pickGreeting } from '../../api/greeting'

// 时段开屏语：打开言叽（挂载 + 切回前台）时顶端浮一句，7 秒自动淡出，点一下提前收。
// 45 分钟节流——开屏语是「见面打招呼」，频繁切前后台不该句句都招呼（2026-07-19）。
const LAST_KEY = 'yanji_greeting_last'
const THROTTLE_MS = 45 * 60 * 1000

export default function GreetingBanner() {
  const [text, setText] = useState(null)
  const [leaving, setLeaving] = useState(false)
  const timers = useRef([])

  useEffect(() => {
    const tryShow = () => {
      try {
        const last = +localStorage.getItem(LAST_KEY) || 0
        if (Date.now() - last < THROTTLE_MS) return
        const line = pickGreeting()
        if (!line) return
        localStorage.setItem(LAST_KEY, String(Date.now()))
        timers.current.forEach(clearTimeout)
        setLeaving(false)
        setText(line)
        timers.current = [
          setTimeout(() => setLeaving(true), 6500),
          setTimeout(() => setText(null), 7200),
        ]
      } catch { /* localStorage 不可用就不打招呼，不能因此挡开屏 */ }
    }
    tryShow()
    const onVis = () => { if (!document.hidden) tryShow() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      timers.current.forEach(clearTimeout)
    }
  }, [])

  if (!text) return null
  return (
    <div
      className={`greeting-banner${leaving ? ' leaving' : ''}`}
      onClick={() => {
        setLeaving(true)
        timers.current.push(setTimeout(() => setText(null), 450))
      }}
    >
      {text}
    </div>
  )
}
