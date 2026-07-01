import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { usePlayer, togglePlay, seek, stop } from '../../utils/player'

function fmt(s) {
  if (!s || !isFinite(s)) return '0:00'
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export default function MiniPlayer() {
  const player = usePlayer()
  const [expanded, setExpanded] = useState(false)
  const lyricRef = useRef(null)

  const track = player.track
  // 当前歌词行
  const activeIdx = useMemo(() => {
    if (!player.lyrics?.length) return -1
    let idx = -1
    for (let i = 0; i < player.lyrics.length; i++) {
      if (player.lyrics[i].t <= player.currentTime + 0.25) idx = i
      else break
    }
    return idx
  }, [player.lyrics, player.currentTime])

  // 歌词自动滚动居中
  useEffect(() => {
    if (!expanded || activeIdx < 0 || !lyricRef.current) return
    const el = lyricRef.current.querySelector(`[data-li="${activeIdx}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeIdx, expanded])

  // 播放条占住底部时，给全局加个类，把聊天输入框等底部元素上推，避免遮挡
  useEffect(() => {
    document.body.classList.toggle('mp-active', !!track)
    return () => document.body.classList.remove('mp-active')
  }, [track])

  if (!track) return null

  const pct = player.duration ? (player.currentTime / player.duration) * 100 : 0

  function onSeekBar(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    seek(Math.max(0, Math.min(1, ratio)) * player.duration)
  }

  const mini = (
    <div className="mini-player">
      <div className="mp-progress" onClick={onSeekBar}>
        <div className="mp-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="mp-body">
        <div className="mp-info" onClick={() => setExpanded(true)}>
          <div className="mp-cover">
            {track.cover
              ? <img src={track.cover} alt="" />
              : <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>}
          </div>
          <div className="mp-meta">
            <div className="mp-title">{track.name}</div>
            <div className="mp-artist">{track.artist || '涟言点的歌'}</div>
          </div>
        </div>
        <button className="mp-btn" onClick={togglePlay} aria-label={player.playing ? '暂停' : '播放'}>
          {player.playing
            ? <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>}
        </button>
        <button className="mp-btn mp-close" onClick={stop} aria-label="关闭">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  )

  const full = expanded && createPortal(
    <div className="mp-full">
      <div className="mp-full-head">
        <button className="mp-full-back" onClick={() => setExpanded(false)}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
      <div className="mp-full-cover">
        {track.cover
          ? <img src={track.cover} alt="" />
          : <svg viewBox="0 0 24 24" width="80" height="80" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>}
      </div>
      <div className="mp-full-title">{track.name}</div>
      <div className="mp-full-artist">{track.artist || '涟言点的歌'}</div>

      <div className="mp-lyrics" ref={lyricRef}>
        {player.lyrics?.length ? player.lyrics.map((l, i) => (
          <div
            key={i}
            data-li={i}
            className={'mp-lyric-line' + (i === activeIdx ? ' active' : '')}
            onClick={() => seek(l.t)}
          >{l.text}</div>
        )) : <div className="mp-lyric-empty">纯音乐，或这首没有歌词</div>}
      </div>

      <div className="mp-full-ctrl">
        <span className="mp-time">{fmt(player.currentTime)}</span>
        <div className="mp-full-bar" onClick={onSeekBar}>
          <div className="mp-full-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="mp-time">{fmt(player.duration)}</span>
      </div>
      <div className="mp-full-btns">
        <button className="mp-full-play" onClick={togglePlay}>
          {player.playing
            ? <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>}
        </button>
      </div>
    </div>,
    document.body
  )

  return <>{mini}{full}</>
}
