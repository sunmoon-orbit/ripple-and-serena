import { useState, useEffect } from 'react'
import { api } from '../api'
import { Sparkles } from 'lucide-react'
import { SCOPES, LAYERS } from './MemoryPanel'

export default function StatsPanel() {
  const [anniv, setAnniv] = useState([])
  const [mems, setMems] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const [a, m] = await Promise.all([api.anniversaries(), api.list({ limit: 500 })])
        setAnniv(a); setMems(m)
      } catch (e) { setError(e.message) }
    })()
  }, [])

  function daysSince(dateStr) {
    const d = new Date(String(dateStr).replace(' ', 'T'))
    return Math.floor((Date.now() - d.getTime()) / 86400000) + 1
  }

  const scopeDist = {}, layerDist = {}
  mems.forEach((m) => {
    scopeDist[m.scope] = (scopeDist[m.scope] || 0) + 1
    if (m.layer) layerDist[m.layer] = (layerDist[m.layer] || 0) + 1
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
        {Object.entries(scopeDist).map(([k, v]) => (
          <div className="bar-row" key={k}>
            <span className="bar-label">{SCOPES[k] || k}</span>
            <div className="bar-track"><div className="bar-fill" style={{ width: (v / maxOf(scopeDist) * 100) + '%' }} /></div>
            <span className="bar-val">{v}</span>
          </div>
        ))}
        {Object.keys(scopeDist).length === 0 && <div className="empty" style={{ padding: 12 }}>暂无数据</div>}
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
