import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

// 聊天记录日历：当前对话按天分组，有消息的日子点亮，点一天跳到那天的第一条。
// 阿颖的主意（2026-07-09）：长对话翻回「那天聊了什么」不用一直往上滚。

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function dayKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ChatCalendar({ messages, onJump, onClose }) {
  // 按天分组：day → { firstId, count }
  const days = useMemo(() => {
    const map = {}
    for (const m of messages) {
      if (m.hidden || !m.createdAt) continue
      const k = dayKey(m.createdAt)
      if (!map[k]) map[k] = { firstId: m.id, count: 0 }
      map[k].count++
    }
    return map
  }, [messages])

  const dayKeys = Object.keys(days).sort()
  const latest = dayKeys.length ? new Date(dayKeys[dayKeys.length - 1]) : new Date()
  const [view, setView] = useState({ y: latest.getFullYear(), m: latest.getMonth() })

  const first = new Date(view.y, view.m, 1)
  const startPad = first.getDay()
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const todayKey = dayKey(Date.now())
  const hasPrev = dayKeys.length && dayKeys[0] < `${view.y}-${String(view.m + 1).padStart(2, '0')}-01`
  const lastOfView = `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
  const hasNext = dayKeys.length && dayKeys[dayKeys.length - 1] > lastOfView

  function nav(delta) {
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }

  return createPortal(
    <div className="chat-cal-overlay" onClick={onClose}>
      <div className="chat-cal" onClick={(e) => e.stopPropagation()}>
        <div className="chat-cal-head">
          <button className="chat-cal-nav" disabled={!hasPrev} onClick={() => nav(-1)}>‹</button>
          <span className="chat-cal-title">{view.y} 年 {view.m + 1} 月</span>
          <button className="chat-cal-nav" disabled={!hasNext} onClick={() => nav(1)}>›</button>
        </div>
        <div className="chat-cal-grid">
          {WEEK_LABELS.map((w) => <span key={w} className="chat-cal-week">{w}</span>)}
          {cells.map((d, i) => {
            if (d === null) return <span key={`p${i}`} />
            const k = `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            const info = days[k]
            return (
              <button
                key={k}
                className={'chat-cal-day' + (info ? ' has-msgs' : '') + (k === todayKey ? ' today' : '')}
                disabled={!info}
                title={info ? `${info.count} 条消息` : undefined}
                onClick={() => { onJump(info.firstId); onClose() }}
              >
                {d}
                {info && <i className="chat-cal-dot" />}
              </button>
            )
          })}
        </div>
        <div className="chat-cal-foot">点亮的日子有聊天记录，点一下跳过去</div>
      </div>
    </div>,
    document.body
  )
}
