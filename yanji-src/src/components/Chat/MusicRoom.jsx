import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { showToast } from '../Toast'
import { playTrack } from '../../utils/player'

// 「涟言点给你的歌」历史面板：我按心情推过的每一首，带着当时为什么点它。
export default function MusicRoom({ onClose }) {
  const moonMemory = useStore((s) => s.moonMemory)
  const base = (moonMemory?.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
  const token = moonMemory?.apiToken
  const auth = { Authorization: `Bearer ${token}` }

  const [picks, setPicks] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return }
    setLoading(true)
    try {
      const r = await fetch(`${base}/music/picks`, { headers: auth })
      setPicks(r.ok ? await r.json() : [])
    } catch { setPicks([]) }
    setLoading(false)
  }, [base, token])

  useEffect(() => { load() }, [load])

  async function toggleLike(p) {
    try {
      const r = await fetch(`${base}/music/picks/${p.id}/like`, {
        method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ liked: p.liked ? 0 : 1 }),
      })
      if (r.ok) setPicks((list) => list.map((x) => x.id === p.id ? { ...x, liked: p.liked ? 0 : 1 } : x))
    } catch { showToast('操作失败', 'error') }
  }

  async function removePick(id) {
    if (!confirm('从歌单里删掉这首？')) return
    try {
      await fetch(`${base}/music/picks/${id}`, { method: 'DELETE', headers: auth })
      setPicks((list) => list.filter((x) => x.id !== id))
    } catch { showToast('删除失败', 'error') }
  }

  function replay(p) {
    playTrack({ name: p.name, artist: p.artist, source: p.source, id: p.track_id, pic_id: p.pic_id, lyric_id: p.lyric_id })
    onClose?.()
  }

  const body = (
    <div className="roost-overlay" onClick={onClose}>
      <div className="roost-modal roost-modal-tall" onClick={(e) => e.stopPropagation()}>
        <div className="roost-modal-header">
          <span>🎵 涟言点给你的歌</span>
          <button className="roost-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="roost-modal-body">
          {!token ? (
            <div className="games-empty">开启记忆库后，我给你点的歌会存在这里</div>
          ) : loading ? (
            <div className="games-empty">载入中…</div>
          ) : picks.length === 0 ? (
            <div className="games-empty">还没有点过歌。等我某个瞬间想到一首合适的，会放进来的。</div>
          ) : picks.map((p) => (
            <div key={p.id} className="mpick-card">
              <button className="mpick-play" onClick={() => replay(p)} aria-label="播放">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>
              </button>
              <div className="mpick-main" onClick={() => replay(p)}>
                <div className="mpick-title">{p.name}
                  {p.artist && <span className="mpick-artist"> · {p.artist}</span>}
                </div>
                {p.reason && <div className="mpick-reason">{p.reason}</div>}
                <div className="mpick-date">{(p.created_at || '').slice(0, 10)}</div>
              </div>
              <button className={'mpick-heart' + (p.liked ? ' on' : '')} onClick={() => toggleLike(p)} aria-label="收藏">
                <svg viewBox="0 0 24 24" width="15" height="15" fill={p.liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
              </button>
              <button className="mpick-del" onClick={() => removePick(p.id)} aria-label="删除">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
