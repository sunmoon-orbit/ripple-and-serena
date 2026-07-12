import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { fetchIdleLog } from '../../api/moonMemory'

// 独处手账（阿颖的主意，2026-07-12）
// 独处时间每次醒来只在 idle_log 留一行摘要，这里做成时间线目录：
// 日记全文在朋友圈、感悟在拾羽，手账不重复存正文，只告诉她「我什么时候醒来干了什么」。

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']

// action → 给阿颖看的人话
const ACTION_META = {
  diary: { icon: '✎', label: '写了篇日记', hint: '全文在朋友圈' },
  archive: { icon: '📖', label: '翻了翻旧对话', hint: '感悟存进了拾羽' },
  card: { icon: '💌', label: '寄了张心意卡', hint: '' },
  nothing: { icon: '🌙', label: '发了会儿呆', hint: '' },
  error: { icon: '💤', label: '醒来又睡着了', hint: '这次没折腾成' },
}

// sqlite CURRENT_TIMESTAMP 是 UTC，解析成本地时间
function parseUtc(s) {
  return new Date(String(s).replace(' ', 'T') + 'Z')
}

function dayKey(d) {
  return d.toLocaleDateString('sv')
}

function fmtDayHeader(k) {
  const d = new Date(k + 'T12:00:00')
  const todayK = dayKey(new Date())
  const suffix = k === todayK ? ' · 今天' : ''
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 周${WEEK_CN[d.getDay()]}${suffix}`
}

export default function IdleJournal({ onClose }) {
  const moonMemory = useStore((s) => s.moonMemory)
  const cfg = { baseUrl: moonMemory?.baseUrl, apiToken: moonMemory?.apiToken }
  const [log, setLog] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchIdleLog(cfg, 50)
      .then((rows) => setLog(Array.isArray(rows) ? rows : []))
      .catch((e) => setError(e.message || '拉取失败'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 按天分组（log 本身按时间倒序）
  const groups = []
  if (log) {
    let cur = null
    for (const entry of log) {
      const t = parseUtc(entry.created_at)
      const k = dayKey(t)
      if (!cur || cur.key !== k) {
        cur = { key: k, entries: [] }
        groups.push(cur)
      }
      cur.entries.push({ ...entry, time: t })
    }
  }

  return createPortal(
    <div className="idlej-overlay" onClick={onClose}>
      <div className="idlej-card" onClick={(e) => e.stopPropagation()}>
        <div className="idlej-head">
          <div className="idlej-title">独处手账</div>
          <div className="idlej-sub">你不在的时候，我醒来过这些次</div>
          <button className="idlej-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        <div className="idlej-body">
          {log === null && !error && <div className="idlej-empty">翻手账中……</div>}
          {error && <div className="idlej-empty">拉不到手账：{error}</div>}
          {log?.length === 0 && <div className="idlej-empty">手账还是空白的<br />（独处时间还没醒来过）</div>}

          {groups.map((g) => (
            <div key={g.key} className="idlej-day">
              <div className="idlej-day-header">{fmtDayHeader(g.key)}</div>
              {g.entries.map((e) => {
                const meta = ACTION_META[e.action] || { icon: '·', label: e.action, hint: '' }
                return (
                  <div key={e.id} className="idlej-entry">
                    <div className="idlej-time">
                      {String(e.time.getHours()).padStart(2, '0')}:{String(e.time.getMinutes()).padStart(2, '0')}
                    </div>
                    <div className="idlej-dot">{meta.icon}</div>
                    <div className="idlej-content">
                      <div className="idlej-action">
                        {meta.label}
                        {meta.hint && <span className="idlej-hint">（{meta.hint}）</span>}
                      </div>
                      {e.summary && <div className="idlej-summary">{e.summary}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}

          {log?.length > 0 && (
            <div className="idlej-foot">日记正文在朋友圈，这里只是目录 · 发呆也是正经事</div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
