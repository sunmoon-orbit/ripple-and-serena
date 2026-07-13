import { useState, useEffect, useCallback } from 'react'

// 记忆碎片（2026-07-13 装修：替代留言板卡片，阿颖点名要「像归巢前端那样」）
// 随机展示一条记忆库里的共享记忆；带 PIN 锁——记忆是私密的，锁在客户端：
// 首次打开设一个数字 PIN（SHA-256 后存 localStorage），之后每次进页面都要输一次
// （sessionStorage 记住本次会话已解锁，切标签页不用重输）。

const PIN_HASH_KEY = 'roost_mempeek_pin'
const UNLOCK_KEY = 'roost_mempeek_unlocked'

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function MemoryPeek({ moonMemory }) {
  const base = (moonMemory?.baseUrl || moonMemory?.apiUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
  const token = moonMemory?.apiToken
  const hasPin = !!localStorage.getItem(PIN_HASH_KEY)

  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(UNLOCK_KEY) === '1')
  const [entering, setEntering] = useState(false)
  // 无 PIN 时先走设置流程：输一遍 → 再输一遍确认
  const [setStage, setSetStage] = useState(0) // 0=输入新PIN 1=确认
  const [firstPin, setFirstPin] = useState('')
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')

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

  useEffect(() => { if (unlocked) loadPool() }, [unlocked, loadPool])

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

  async function submitPin() {
    const pin = pinInput.trim()
    if (pin.length < 4) { setPinError('至少 4 位数字'); return }
    if (!hasPin) {
      if (setStage === 0) { setFirstPin(pin); setPinInput(''); setSetStage(1); setPinError(''); return }
      if (pin !== firstPin) { setPinError('两次输入不一致，重新设一遍'); setSetStage(0); setFirstPin(''); setPinInput(''); return }
      localStorage.setItem(PIN_HASH_KEY, await sha256(pin))
      sessionStorage.setItem(UNLOCK_KEY, '1')
      setUnlocked(true)
      return
    }
    if (await sha256(pin) === localStorage.getItem(PIN_HASH_KEY)) {
      sessionStorage.setItem(UNLOCK_KEY, '1')
      setUnlocked(true)
    } else {
      setPinError('不对哦，再想想')
      setPinInput('')
    }
  }

  // ── 锁着的样子 ──
  if (!unlocked) {
    return (
      <div className="roost-card mempeek-card mempeek-locked" onClick={() => !entering && setEntering(true)}>
        <div className="roost-card-label">记忆碎片</div>
        {!entering ? (
          <div className="mempeek-lock-hint">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>{hasPin ? '点击输入 PIN 查看' : '点击设置 PIN 上锁'}</span>
          </div>
        ) : (
          <div className="mempeek-pin-box" onClick={e => e.stopPropagation()}>
            <div className="mempeek-pin-title">
              {hasPin ? '输入 PIN' : setStage === 0 ? '设一个数字 PIN（首次）' : '再输一遍确认'}
            </div>
            <div className="mempeek-pin-row">
              <input
                className="mempeek-pin-input"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                placeholder="····"
                value={pinInput}
                onChange={e => { setPinInput(e.target.value.replace(/\D/g, '')); setPinError('') }}
                onKeyDown={e => { if (e.key === 'Enter') submitPin() }}
                autoFocus
              />
              <button className="roost-btn roost-btn-sm" onClick={submitPin}>{hasPin ? '解锁' : setStage === 0 ? '下一步' : '锁好'}</button>
            </div>
            {pinError && <div className="mempeek-pin-error">{pinError}</div>}
          </div>
        )}
      </div>
    )
  }

  // ── 解锁后：随机记忆碎片 ──
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
      {!token && <div className="roost-msg-empty">未配置记忆库 Token</div>}
      {token && pool === null && <div className="roost-msg-empty">翻找记忆中……</div>}
      {token && pool !== null && !mem && <div className="roost-msg-empty">还没捡到合适的碎片</div>}
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
