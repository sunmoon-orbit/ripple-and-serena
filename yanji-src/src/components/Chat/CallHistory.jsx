import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'

// 通话记录（阿颖的主意，2026-07-16）
// 捞出所有对话里的通话标记（call=拨出/接通，callInvite.missed=未接来电），
// 按时间倒序列一张单子；点任意一条跳回那次通话在对话里的位置——
// 通话前后的语音条还能重听（TTS 生成过就缓存，不重新合成）。

function fmtDur(secs) {
  return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
}

function dayLabel(ts) {
  const d = new Date(ts)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const that = new Date(d); that.setHours(0, 0, 0, 0)
  const diff = Math.round((today - that) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  return `${d.getMonth() + 1}月${d.getDate()}日` + (d.getFullYear() !== today.getFullYear() ? `·${d.getFullYear()}` : '')
}

function timeLabel(ts) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function CallHistory({ onClose, onJump }) {
  const chats = useStore((s) => s.chats)
  const messagesByChatId = useStore((s) => s.messagesByChatId)

  const groups = useMemo(() => {
    const calls = []
    for (const c of chats) {
      for (const m of messagesByChatId[c.id] || []) {
        if (m.call && m.call.status !== 'ongoing') {
          // 拨出/接通的通话（接听的来电也会生成一条 call 标记，这里就是全部实际通话）
          calls.push({
            key: m.id, chatId: c.id, chatTitle: c.title, mid: m.id, at: m.createdAt,
            kind: m.call.status === 'cancelled' ? 'cancelled' : 'ended',
            duration: m.call.duration,
          })
        } else if (m.callInvite && m.callInvite.status === 'missed') {
          // 未接来电（接听的 invite 不列：它后面跟着的 call 标记已经代表那次通话）
          calls.push({
            key: m.id, chatId: c.id, chatTitle: c.title, mid: m.id, at: m.createdAt,
            kind: 'missed', reason: m.callInvite.reason,
          })
        }
      }
    }
    calls.sort((a, b) => b.at - a.at)
    // 按天分组
    const out = []
    for (const call of calls) {
      const label = dayLabel(call.at)
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, items: [] })
      out[out.length - 1].items.push(call)
    }
    return out
  }, [chats, messagesByChatId])

  const total = groups.reduce((n, g) => n + g.items.length, 0)

  return createPortal(
    <div className="health-overlay" onClick={onClose}>
      <div className="health-card" onClick={(e) => e.stopPropagation()}>
        <div className="health-head">
          <div className="health-title">通话记录</div>
          <div className="health-sub">{total ? `一共 ${total} 通 · 点一条跳回当时` : '打过的电话都会记在这里'}</div>
          <button className="health-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        {!total && (
          <div style={{ textAlign: 'center', padding: '28px 0 36px', color: 'var(--text-faint)', fontSize: 14 }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>📞</div>
            还没有通话记录——侧边栏「语音通话」打一个试试？
          </div>
        )}

        {groups.map((g) => (
          <div key={g.label} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '10px 2px 6px', fontWeight: 600 }}>{g.label}</div>
            {g.items.map((c) => (
              <button
                key={c.key}
                onClick={() => { onClose?.(); onJump?.(c.chatId, c.mid) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '10px 10px', marginBottom: 4, borderRadius: 12, border: '1px solid var(--border)',
                  background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)',
                }}
              >
                {/* 方向/状态图标：未接=红，取消=灰，接通=主题色 */}
                <span style={{
                  fontSize: 16, width: 30, height: 30, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: c.kind === 'missed' ? 'rgba(220,80,80,0.12)' : 'var(--border)',
                }}>
                  {c.kind === 'missed' ? '📵' : c.kind === 'cancelled' ? '📴' : '📞'}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: 'block', fontSize: 14, fontWeight: 600,
                    color: c.kind === 'missed' ? 'var(--danger, #d05050)' : 'var(--text)',
                  }}>
                    {c.kind === 'missed' ? '未接来电' : c.kind === 'cancelled' ? '已取消' : `通话 ${fmtDur(c.duration || 0)}`}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.reason ? `${c.reason} · ` : ''}{c.chatTitle}
                  </span>
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-faint)', flexShrink: 0 }}>{timeLabel(c.at)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>,
    document.body
  )
}
