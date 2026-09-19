import { useRef, useState } from 'react'
import { getCover, searchCatalog } from '../../api/music'
import { enqueueTrack, getState, playTrack, setQueue } from '../../utils/player'
import { queueMusicShare } from '../../utils/musicShare'
import { useStore } from '../../store'
import { showToast } from '../Toast'

function artistName(value) {
  return Array.isArray(value) ? value.join(' / ') : (value || '')
}

function normalizeResult(item, source = 'netease') {
  return {
    name: item.name || '未知曲目',
    artist: artistName(item.artist) || '未知歌手',
    source,
    id: String(item.url_id || item.id || ''),
    pic_id: item.pic_id || '',
    lyric_id: String(item.lyric_id || item.id || ''),
    cover: item.cover || '',
  }
}

export default function SongSearch({ onDone }) {
  const activePanel = useStore((state) => state.activePanel)
  const setActivePanel = useStore((state) => state.setActivePanel)
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [alsoPlay, setAlsoPlay] = useState(false)
  const requestRef = useRef(0)

  async function search(event) {
    event?.preventDefault()
    const query = keyword.trim()
    if (!query) return
    const request = ++requestRef.current
    setLoading(true)
    const found = await searchCatalog(query, 10)
    const normalized = found.map((item) => normalizeResult(item, item.catalog_source))
    const hydrated = await Promise.all(normalized.map(async (track) => ({
      ...track,
      cover: track.pic_id ? await getCover(track.source, track.pic_id, 160) : '',
    })))
    if (request === requestRef.current) {
      setResults(hydrated)
      setLoading(false)
    }
  }

  async function play(track) {
    setBusyId(`play:${track.source}:${track.id}`)
    setQueue([track], 0)
    const resolved = await playTrack(track)
    setBusyId('')
    if (!resolved) { showToast('这首暂时没有可播放版本', 'error'); return }
    onDone?.()
  }

  function enqueue(track) {
    if (!getState().track) { void play(track); return }
    enqueueTrack(track)
    showToast('已加入播放队列', 'info')
  }

  async function share(track) {
    let shared = track
    if (alsoPlay) {
      setBusyId(`share:${track.source}:${track.id}`)
      setQueue([track], 0)
      const resolved = await playTrack(track)
      setBusyId('')
      if (!resolved) { showToast('歌曲暂时无法播放，仍会把曲目信息点给 TA', 'info') }
      else shared = resolved
    }
    const target = activePanel === 'crossing' ? 'crossing' : 'chat'
    queueMusicShare(target, shared)
    if (activePanel !== target) setActivePanel(target, 'music-share')
    showToast(target === 'crossing' ? '点歌已送往当前 Agent 会话' : '点歌已送往当前 Murmur 对话', 'info')
    onDone?.()
  }

  return (
    <section className="song-search" aria-label="搜索歌曲">
      <form className="song-search-form" onSubmit={search}>
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="输入歌名或歌手" aria-label="歌名或歌手" />
        <button type="submit" disabled={loading || !keyword.trim()}>{loading ? '搜索中…' : '搜索'}</button>
      </form>
      <label className="song-share-play">
        <input type="checkbox" checked={alsoPlay} onChange={(event) => setAlsoPlay(event.target.checked)} />
        <span>点给 TA 时同时播放</span>
      </label>
      <div className="song-search-results" aria-live="polite">
        {!loading && keyword.trim() && results.length === 0 && <div className="song-search-empty">没有找到歌曲，换个关键词试试</div>}
        {results.map((track) => {
          const key = `${track.source}:${track.id}`
          const busy = busyId.endsWith(key)
          return (
            <article className="song-result" key={key}>
              <div className="song-result-cover">
                {track.cover
                  ? <img src={track.cover} alt="" />
                  : <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>}
              </div>
              <div className="song-result-meta"><strong>{track.name}</strong><span>{track.artist}</span></div>
              <div className="song-result-actions">
                <button onClick={() => play(track)} disabled={busy} aria-label={`播放 ${track.name}`}>播放</button>
                <button onClick={() => enqueue(track)} disabled={busy} aria-label={`加入队列 ${track.name}`}>加入队列</button>
                <button className="primary" onClick={() => share(track)} disabled={busy} aria-label={`点给 TA ${track.name}`}>点给 TA</button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
