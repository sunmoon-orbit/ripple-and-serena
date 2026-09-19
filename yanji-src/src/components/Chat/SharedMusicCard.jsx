import { useState } from 'react'
import { playTrack, setQueue, togglePlay, usePlayer } from '../../utils/player'

export default function SharedMusicCard({ track }) {
  const player = usePlayer()
  const [loading, setLoading] = useState(false)
  const current = player.track && player.track.name === track?.name && player.track.artist === track?.artist

  async function handlePlay(event) {
    event.stopPropagation()
    if (current) { togglePlay(); return }
    setLoading(true)
    setQueue([track], 0)
    await playTrack(track)
    setLoading(false)
  }

  return (
    <div className="music-card music-share-card" aria-label={`点歌：${track?.name || '未知曲目'}`}>
      <div className="music-card-cover">
        {track?.cover
          ? <img src={track.cover} alt="" />
          : <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>}
      </div>
      <div className="music-card-main">
        <div className="music-share-label">点给 TA 的歌</div>
        <div className="music-card-title">{track?.name || '未知曲目'}</div>
        <div className="music-card-artist">{track?.artist || '未知歌手'}</div>
      </div>
      <button className="music-card-play" onClick={handlePlay} aria-label={current && player.playing ? '暂停' : '播放'} disabled={loading}>
        {loading
          ? <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="4" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="20" cy="12" r="2"/></svg>
          : current && player.playing
            ? <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>}
      </button>
    </div>
  )
}
