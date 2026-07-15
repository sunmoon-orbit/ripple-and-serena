import { useState, useEffect } from 'react'
import { api } from '../api'
import { Sparkles } from 'lucide-react'
import { SCOPES, LAYERS } from './MemoryPanel'

const TYPE_LABELS = { memory: '记忆', tech: '技术', dream: '梦境', deep: '深层', handoff: '交接信', diary: '日记', window: '窗口', anchor: '锚点', treasure: '宝藏', boot: '开窗', craft: '手作', book: '书单' }

export default function StatsPanel() {
  const [anniv, setAnniv] = useState([])
  const [mems, setMems] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const [a, m] = await Promise.all([api.anniversaries(), api.list({ limit: 1000 })])
        setAnniv(a); setMems(m)
      } catch (e) { setError(e.message) }
    })()
  }, [])

  function daysSince(dateStr) {
    const d = new Date(String(dateStr).replace(' ', 'T'))
    return Math.floor((Date.now() - d.getTime()) / 86400000) + 1
  }

  const scopeDist = {}, layerDist = {}, typeDist = {}
  mems.forEach((m) => {
    scopeDist[m.scope] = (scopeDist[m.scope] || 0) + 1
    if (m.layer) layerDist[m.layer] = (layerDist[m.layer] || 0) + 1
    if (m.type) typeDist[m.type] = (typeDist[m.type] || 0) + 1
  })
  const maxOf = (o) => Math.max(1, ...Object.values(o))

  return (
    <div className="panel">
      <div className="topbar"><h1>纪念 · 统计</h1></div>

      {anniv.map((a) => (
        <div className="anniv" key={a.id}>
          <div className="anniv-title"><Sparkles size={15} />{a.title}</div>
          <div className="anniv-days">第 {daysSince(a.anniversary_date)} 天</div>
          <div className="anniv-sub">{a.person_name} · 从 {a.anniversary_date} 起</div>
        </div>
      ))}

      {error && <div className="error-box">{error}</div>}

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-num">{mems.length}</div><div className="stat-label">活跃记忆</div></div>
        <div className="stat-card"><div className="stat-num">{layerDist.core || 0}</div><div className="stat-label">核心记忆</div></div>
      </div>

      <div className="section-title">按范围</div>
      <div className="stat-card">
        {Object.entries(scopeDist).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
          <div className="bar-row" key={k}>
            <span className="bar-label">{SCOPES[k] || k}</span>
            <div className="bar-track"><div className="bar-fill" style={{ width: (v / maxOf(scopeDist) * 100) + '%' }} /></div>
            <span className="bar-val">{v}</span>
          </div>
        ))}
        {Object.keys(scopeDist).length === 0 && <div className="empty" style={{ padding: 12 }}>暂无数据</div>}
      </div>

      <div className="section-title">按类型</div>
      <div className="stat-card">
        {Object.entries(typeDist).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
          <div className="bar-row" key={k}>
            <span className="bar-label">{TYPE_LABELS[k] || k}</span>
            <div className="bar-track"><div className="bar-fill" style={{ width: (v / maxOf(typeDist) * 100) + '%' }} /></div>
            <span className="bar-val">{v}</span>
          </div>
        ))}
      </div>

      <div className="section-title">按层级</div>
      <div className="stat-card">
        {Object.entries(layerDist).map(([k, v]) => (
          <div className="bar-row" key={k}>
            <span className="bar-label">{LAYERS[k] || k}</span>
            <div className="bar-track"><div className="bar-fill" style={{ width: (v / maxOf(layerDist) * 100) + '%' }} /></div>
            <span className="bar-val">{v}</span>
          </div>
        ))}
        {Object.keys(layerDist).length === 0 && <div className="empty" style={{ padding: 12 }}>暂无分层</div>}
      </div>
    </div>
  )
}
