import { useState, useEffect, useCallback } from 'react'

// 记忆碎片（2026-07-13 装修：替代留言板卡片，阿颖点名要「像归巢前端那样」）
// 随机展示一条记忆库里的共享记忆。
// 锁的方式（0713 当天返工）：跟卡册一样的天然锁——设置里连上记忆库 apiToken 才看得到，
// 没钥匙的人打开只有一把锁。第一版做成了每次输 PIN，阿颖澄清她要的就是 apikey 这道门，
// PIN 撤了（教训：「要填密码」先问清是哪扇门的密码）。

export default function MemoryPeek({ moonMemory }) {
  const base = (moonMemory?.baseUrl || moonMemory?.apiUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
  const token = moonMemory?.apiToken

  const [pool, setPool] = useState(null)
  const [mem, setMem] = useState(null)
  const [spinning, setSpinning] = useState(false)

  const pickRandom = (list) => list[Math.floor(Math.random() * list.length)]

  const loadPool = useCallback(async () => {
    if (!token) return
    try {
      const r = await fetch(`${base}/memories?limit=80&scope=shared&deleted=false`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) { setPool([]); return }
      const rows = await r.json()
      const good = (Array.isArray(rows) ? rows : []).filter(
        m => !m.deleted_at && (m.importance || 0) >= 5 && m.content && m.content.length > 20
      )
      setPool(good)
      if (good.length) setMem(pickRandom(good))
    } catch { setPool([]) }
  }, [base, token])

  useEffect(() => { loadPool() }, [loadPool])

  function refresh() {
    if (!pool?.length) { loadPool(); return }
    setSpinning(true)
    setMem(prev => {
      if (pool.length < 2) return prev
      let next = prev
      while (next === prev) next = pickRandom(pool)
      return next
    })
    setTimeout(() => setSpinning(false), 500)
  }

  // ── 没钥匙：只有一把锁 ──
  if (!token) {
    return (
      <div className="roost-card mempeek-card">
        <div className="roost-card-label">记忆碎片</div>
        <div className="mempeek-lock-hint">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>在设置里连上记忆库后可见</span>
        </div>
      </div>
    )
  }

  // ── 有钥匙：随机记忆碎片 ──
  const content = mem ? mem.content.replace(/【[^】]*】/g, '').trim().slice(0, 200) : ''
  const tags = mem?.tags ? String(mem.tags).split(',').map(t => t.trim()).filter(Boolean).slice(0, 5) : []

  return (
    <div className="roost-card mempeek-card">
      <div className="mempeek-header">
        <div className="roost-card-label" style={{ margin: 0 }}>记忆碎片</div>
        <div className="mempeek-header-right">
          {mem && <span className="roost-msg-date" style={{ margin: 0 }}>{(mem.created_at || '').slice(0, 10)}</span>}
          <button className={'mempeek-refresh' + (spinning ? ' spinning' : '')} onClick={refresh} title="换一条">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" /><polyline points="21 3 21 9 15 9" />
            </svg>
          </button>
        </div>
      </div>
      {pool === null && <div className="roost-msg-empty">翻找记忆中……</div>}
      {pool !== null && !mem && <div className="roost-msg-empty">还没捡到合适的碎片</div>}
      {mem && (
        <div key={mem.id} className="roost-msg-rotate">
          <div className="mempeek-content">{content}{mem.content.length > 200 ? '……' : ''}</div>
          {tags.length > 0 && (
            <div className="mempeek-tags">
              {tags.map(t => <span key={t} className="mempeek-tag">{t}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
