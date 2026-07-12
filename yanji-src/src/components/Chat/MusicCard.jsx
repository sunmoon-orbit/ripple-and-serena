import { useState } from 'react'
import { useStore } from '../../store'
import { playTrack, togglePlay, usePlayer } from '../../utils/player'
import { findSubstitute } from '../../api/music'

// 聊天里「涟言点给你的歌」卡片：推卡片给阿颖，她点了才播（绝不自动播）。
export default function MusicCard({ name, artist, reason }) {
  const moonMemory = useStore((s) => s.moonMemory)
  const player = usePlayer()
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [subName, setSubName] = useState('') // 代餐曲名（原曲没货时同歌手替补）

  const isCurrent = player.track && player.track.name === name && (!!player.track.url)
  const showLoading = loading || (isCurrent && player.loading)

  async function handlePlay() {
    if (showLoading) return
    // 已经是当前这首：切播放/暂停，不重新解析
    if (isCurrent) { togglePlay(); return }
    setErr('')
    setLoading(true)
    const resolved = await playTrack({ name, artist })
    setLoading(false)
    if (!resolved) { setErr('几个源都没找到能放的版本'); return }
    setSubName('')
    // 存进「涟言点给你的歌」历史（带上我为什么点它）
    if (moonMemory?.apiToken) {
      const base = (moonMemory.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
      fetch(`${base}/music/picks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${moonMemory.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: resolved.source, track_id: resolved.id, name: resolved.name,
          artist: resolved.artist, pic_id: resolved.pic_id, lyric_id: resolved.lyric_id,
          reason: reason || '',
        }),
      }).catch(() => {})
    }
  }

  // 原曲全源没货：搜同歌手，跳过原曲，播第一首能放的（机械替补不进「涟言点的歌」历史——那本账只记我亲自点的）
  async function handleSubstitute() {
    if (loading) return
    setLoading(true)
    const cand = await findSubstitute(artist, name)
    if (!cand) { setLoading(false); setErr('这位歌手全网都没货，是真·绝版了'); return }
    const resolved = await playTrack(cand)
    setLoading(false)
    if (!resolved) { setErr('代餐也没抢到，今天源不太行'); return }
    setErr('')
    setSubName(resolved.name)
  }

  return (
    <div className="music-card">
      <div className="music-card-cover">
        {isCurrent && player.track?.cover
          ? <img src={player.track.cover} alt="" />
          : <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>}
      </div>
      <div className="music-card-main">
        <div className="music-card-title">{name}</div>
        <div className="music-card-artist">{artist || '涟言点的歌'}</div>
        {reason && <div className="music-card-reason">{reason}</div>}
        {err && <div className="music-card-err">{err}</div>}
        {err && artist && !subName && (
          <button className="music-card-sub-btn" onClick={handleSubstitute} disabled={loading}>
            {loading ? '找代餐中…' : `找一首${artist}能放的代餐 →`}
          </button>
        )}
        {subName && <div className="music-card-sub-note">代餐：{subName}（原曲的心意不变）</div>}
      </div>
      <button className="music-card-play" onClick={handlePlay} aria-label="播放">
        {showLoading ? (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="4" cy="12" r="2"><animate attributeName="opacity" values="1;.3;1" dur="1s" repeatCount="indefinite" begin="0s"/></circle><circle cx="12" cy="12" r="2"><animate attributeName="opacity" values="1;.3;1" dur="1s" repeatCount="indefinite" begin=".2s"/></circle><circle cx="20" cy="12" r="2"><animate attributeName="opacity" values="1;.3;1" dur="1s" repeatCount="indefinite" begin=".4s"/></circle></svg>
        ) : (isCurrent && player.playing) ? (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>
        )}
      </button>
    </div>
  )
}
