import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { showToast } from '../Toast'
import { playTrack, setQueue } from '../../utils/player'

export default function MusicRoom({ onClose }) {
  const moonMemory = useStore((s) => s.moonMemory)
  const base = (moonMemory?.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
  const token = moonMemory?.apiToken
  const auth = { Authorization: `Bearer ${token}` }

  const [picks, setPicks] = useState([])
  const [playlists, setPlaylists] = useState([])
  const [activeTab, setActiveTab] = useState('all') // 'all' | playlist id
  const [playlistSongs, setPlaylistSongs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNewPl, setShowNewPl] = useState(false)
  const [newPlName, setNewPlName] = useState('')
  const [addingTo, setAddingTo] = useState(null) // pick id being added to playlist

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return }
    setLoading(true)
    try {
      const [r1, r2] = await Promise.all([
        fetch(`${base}/music/picks`, { headers: auth }),
        fetch(`${base}/music/playlists`, { headers: auth }),
      ])
      setPicks(r1.ok ? await r1.json() : [])
      setPlaylists(r2.ok ? await r2.json() : [])
    } catch { setPicks([]); setPlaylists([]) }
    setLoading(false)
  }, [base, token])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (activeTab === 'all' || !token) return
    fetch(`${base}/music/playlists/${activeTab}/songs`, { headers: auth })
      .then(r => r.ok ? r.json() : []).then(setPlaylistSongs).catch(() => setPlaylistSongs([]))
  }, [activeTab, base, token])

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
    if (!confirm('从记录里删掉这首？')) return
    try {
      await fetch(`${base}/music/picks/${id}`, { method: 'DELETE', headers: auth })
      setPicks((list) => list.filter((x) => x.id !== id))
    } catch { showToast('删除失败', 'error') }
  }

  function replay(p, list) {
    const q = list || picks
    const idx = q.findIndex(s => (s.pick_id || s.id) === (p.pick_id || p.id))
    const tracks = q.map(s => ({ name: s.name, artist: s.artist, source: s.source, id: s.track_id, pic_id: s.pic_id, lyric_id: s.lyric_id }))
    setQueue(tracks, idx >= 0 ? idx : 0)
    playTrack(tracks[idx >= 0 ? idx : 0])
    onClose?.()
  }

  async function createPlaylist() {
    if (!newPlName.trim()) return
    try {
      const r = await fetch(`${base}/music/playlists`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPlName.trim() }),
      })
      if (r.ok) { const pl = await r.json(); setPlaylists(prev => [pl, ...prev]); setNewPlName(''); setShowNewPl(false) }
    } catch { showToast('创建失败', 'error') }
  }

  async function deletePlaylist(id) {
    if (!confirm('删除这个歌单？')) return
    try {
      await fetch(`${base}/music/playlists/${id}`, { method: 'DELETE', headers: auth })
      setPlaylists(prev => prev.filter(p => p.id !== id))
      if (activeTab === id) setActiveTab('all')
    } catch { showToast('删除失败', 'error') }
  }

  async function addSongToPlaylist(plId, pickId) {
    try {
      await fetch(`${base}/music/playlists/${plId}/songs`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pick_id: pickId }),
      })
      setPlaylists(prev => prev.map(p => p.id === plId ? { ...p, song_count: (p.song_count || 0) + 1 } : p))
      showToast('已添加', 'info')
    } catch { showToast('添加失败', 'error') }
    setAddingTo(null)
  }

  async function removeSongFromPlaylist(plId, pickId) {
    try {
      await fetch(`${base}/music/playlists/${plId}/songs/${pickId}`, { method: 'DELETE', headers: auth })
      setPlaylistSongs(prev => prev.filter(s => s.id !== pickId))
      setPlaylists(prev => prev.map(p => p.id === plId ? { ...p, song_count: Math.max(0, (p.song_count || 1) - 1) } : p))
    } catch { showToast('移除失败', 'error') }
  }

  const displayList = activeTab === 'all' ? picks : playlistSongs

  function renderCard(p, isList) {
    return (
      <div key={p.ps_id || p.id} className="mpick-card">
        <button className="mpick-play" onClick={() => replay(p, displayList)} aria-label="播放">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>
        </button>
        <div className="mpick-main" onClick={() => replay(p, displayList)}>
          <div className="mpick-title">{p.name}
            {p.artist && <span className="mpick-artist"> · {p.artist}</span>}
          </div>
          {p.reason && <div className="mpick-reason">{p.reason}</div>}
          <div className="mpick-date">{(p.created_at || '').slice(0, 10)}</div>
        </div>
        {activeTab === 'all' && playlists.length > 0 && (
          <div className="mpick-addto-wrap">
            <button className="mpick-addto" onClick={() => setAddingTo(addingTo === p.id ? null : p.id)} aria-label="加入歌单">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            {addingTo === p.id && (
              <div className="mpick-pl-dropdown">
                {playlists.map(pl => (
                  <button key={pl.id} className="mpick-pl-opt" onClick={() => addSongToPlaylist(pl.id, p.id)}>{pl.name}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {activeTab === 'all' ? (
          <>
            <button className={'mpick-heart' + (p.liked ? ' on' : '')} onClick={() => toggleLike(p)} aria-label="收藏">
              <svg viewBox="0 0 24 24" width="15" height="15" fill={p.liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
            </button>
            <button className="mpick-del" onClick={() => removePick(p.id)} aria-label="删除">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </>
        ) : (
          <button className="mpick-del" onClick={() => removeSongFromPlaylist(activeTab, p.id)} aria-label="从歌单移除">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
      </div>
    )
  }

  const body = (
    <div className="roost-overlay" onClick={onClose}>
      <div className="roost-modal roost-modal-tall" onClick={(e) => e.stopPropagation()}>
        <div className="roost-modal-header">
          <span>🎵 涟言点给你的歌</span>
          <button className="roost-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="mpick-tabs">
          <button className={'mpick-tab' + (activeTab === 'all' ? ' active' : '')} onClick={() => setActiveTab('all')}>全部</button>
          {playlists.map(pl => (
            <button key={pl.id} className={'mpick-tab' + (activeTab === pl.id ? ' active' : '')} onClick={() => setActiveTab(pl.id)}>
              {pl.name} <span className="mpick-tab-count">{pl.song_count || 0}</span>
              {activeTab === pl.id && <span className="mpick-tab-del" onClick={(e) => { e.stopPropagation(); deletePlaylist(pl.id) }}>✕</span>}
            </button>
          ))}
          <button className="mpick-tab mpick-tab-add" onClick={() => setShowNewPl(true)}>+</button>
        </div>
        {showNewPl && (
          <div className="mpick-new-pl">
            <input value={newPlName} onChange={e => setNewPlName(e.target.value)} placeholder="歌单名称" autoFocus
              onKeyDown={e => e.key === 'Enter' && createPlaylist()} />
            <button onClick={createPlaylist}>创建</button>
            <button onClick={() => { setShowNewPl(false); setNewPlName('') }}>取消</button>
          </div>
        )}
        <div className="roost-modal-body">
          {!token ? (
            <div className="games-empty">开启记忆库后，我给你点的歌会存在这里</div>
          ) : loading ? (
            <div className="games-empty">载入中…</div>
          ) : displayList.length === 0 ? (
            <div className="games-empty">{activeTab === 'all' ? '还没有点过歌。等我某个瞬间想到一首合适的，会放进来的。' : '歌单是空的，去「全部」里把喜欢的歌加进来吧'}</div>
          ) : (
            <>
              {activeTab !== 'all' && displayList.length > 1 && (
                <button className="mpick-play-all" onClick={() => replay(displayList[0], displayList)}>
                  ▶ 播放全部（{displayList.length} 首）
                </button>
              )}
              {displayList.map(p => renderCard(p, activeTab !== 'all'))}
            </>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
