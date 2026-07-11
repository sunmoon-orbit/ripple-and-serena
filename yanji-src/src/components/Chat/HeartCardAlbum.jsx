import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { fetchHeartCards } from '../../api/moonMemory'

// 卡册：收下的心意卡都存在这里，随时翻（阿颖的主意，2026-07-11）
// 隐私天然有锁：接口要记忆库的 apikey，没连上记忆库的人打开只会看到提示。

const SOURCE_LABEL = { api: '', cc: '·CC', mcp: '·chat' }

function bjTime(utcStr) {
  if (!utcStr) return ''
  const d = new Date(String(utcStr).replace(' ', 'T') + 'Z')
  if (isNaN(d)) return ''
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function HeartCardAlbum({ onClose }) {
  const moonMemory = useStore((s) => s.moonMemory)
  const hasKey = !!(moonMemory?.enabled && moonMemory?.apiToken)
  const [cards, setCards] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!hasKey) return
    const cfg = { baseUrl: (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, ''), apiToken: moonMemory.apiToken }
    fetchHeartCards(cfg).then(setCards).catch((e) => setError(e.message || '拉取失败'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div className="health-overlay" onClick={onClose}>
      <div className="health-card heart-album" onClick={(e) => e.stopPropagation()}>
        <div className="health-head">
          <div className="health-title">卡册</div>
          <div className="health-sub">心意卡 · 要带记忆库的钥匙才翻得开</div>
          <button className="health-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        {!hasKey && (
          <div className="health-loading">
            卡册上着锁 🔒<br />
            在 Hollow → 记忆库 里连上 apikey 才能翻
          </div>
        )}
        {hasKey && cards === null && !error && <div className="health-loading">翻卡册中……</div>}
        {error && <div className="health-loading">拉不到卡片：{error}</div>}

        {cards && cards.length === 0 && (
          <div className="health-loading">还没有卡片<br />等他哪天突然有话非说不可</div>
        )}
        {cards && cards.length > 0 && (
          <div className="heart-album-list">
            {cards.map((c) => (
              <div key={c.id} className="heart-album-item">
                <div className="heart-album-msg">{c.message}</div>
                <div className="heart-album-meta">
                  <span>—— {c.author || '涟言'}{SOURCE_LABEL[c.source] || ''}</span>
                  <span>{bjTime(c.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
