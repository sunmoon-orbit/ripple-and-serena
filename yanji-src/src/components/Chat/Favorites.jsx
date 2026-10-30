import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useToolMemory } from './ToolMemory'
import { useMessageSpeech } from './useMessageSpeech'
import { listFavorites, noteFavorite, removeFavorite } from '../../api/favorites'
import { useThemedConfirm } from '../ThemedConfirmDialog'

// 收藏（1030）：她在言叽点星、在归巢长按收下的话，同一本。
// 归巢收的她的语音条，录音在归巢服务器上，这边只显示转出来的字；我的语音条在这边点了现合成。
export function StarIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2" /></svg>
}

const VNOTE_RE = /^【语音条·(\d+)秒】([\s\S]*?)(?:\n〔机器听到：([^〕]*)〕)?\n\[附件:\s*([^\]]+)\]\s*$/
const STICKER_BASE = 'https://memory.ravenlove.cc/raven/stickers/'
const stickerImg = name => {
  const f = name.split('｜')[0].trim()
  return `<img src="${STICKER_BASE}${/\.[a-z0-9]+$/i.test(f) ? f : f + '.jpg'}" alt="">`
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function parse(row) {
  let text = String(row.text || '')
  if (row.role === 'user') {
    text = text.replace(/^> 引用：[^\n]*\n?/, '').replace(/^【语音(?:·双语)?】/, '')
    const vn = VNOTE_RE.exec(text)
    if (vn) return { voiceNote: { sec: +vn[1], text: vn[2].trim() } }
    return { html: esc(text).replace(/\[sticker:([^\]]+)\]/g, (_, n) => stickerImg(n)).replace(/\[附件:\s*([^\]]+)\]/g, '〔附件〕').replace(/\n/g, '<br>') }
  }
  const isVoice = /\[voice(?::[^\]]*)?\]/i.test(text)
  text = text.replace(/\[voice(?::[^\]]*)?\]/gi, '').replace(/^> ?引用[：:][^\n]*\n+/, '').trim()
  const spoken = text.replace(/^[ \t]*>[ \t]+.*$/gm, '').trim()
  return {
    isVoice, spoken,
    html: marked.parse(text.replace(/\[sticker:([^\]]+)\]/g, (_, n) => stickerImg(n)).replace(/\[附件:\s*([^\]]+)\]/g, '〔附件〕')),
  }
}

function when(row) {
  const t = row.msg_at ? new Date(row.msg_at) : new Date(String(row.created_at).replace(' ', 'T') + 'Z')
  return isNaN(t) ? '' : t.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

function FavCard({ row, config, onRemove, onNote }) {
  const p = parse(row)
  const speech = useMessageSpeech(p.isVoice ? p.spoken : '', config, !!p.isVoice)
  return <article className="fav-card">
    <div className="fav-who"><span>{row.role === 'assistant' ? '阿言' : '我'}</span><span className="fav-tag">{row.source === 'yanji' ? '言叽' : '归巢'}</span>{row.saved_by === '涟言' && <span className="fav-tag">阿言收的</span>}<span className="fav-when">{when(row)}</span></div>
    {p.voiceNote ? <>
      <div className="fav-voice is-static">🎙 语音条 {p.voiceNote.sec}″<small>录音在归巢里听</small></div>
      {p.voiceNote.text && <div className="fav-sub">{p.voiceNote.text}</div>}
    </> : <>
      {p.isVoice && <button type="button" className={`fav-voice${speech.status === 'playing' ? ' playing' : ''}`} onClick={() => speech.toggle()} disabled={!speech.available}>
        {speech.status === 'loading' ? '…' : speech.status === 'playing' ? '❚❚' : '▶'}<span className="fav-wave" />语音
      </button>}
      <div className={`fav-body${p.isVoice ? ' fav-sub' : ''}`} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(p.html) }} />
    </>}
    {row.note && <div className="fav-note">— {row.note}</div>}
    <div className="fav-acts"><button type="button" onClick={() => onNote(row)}>{row.note ? '改一句' : '写一句'}</button><button type="button" onClick={() => onRemove(row)}>取消收藏</button></div>
  </article>
}

export default function Favorites({ onClose }) {
  const config = useToolMemory()
  const confirm = useThemedConfirm()
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  async function load(before = '') {
    setLoading(true); setError('')
    try {
      const got = await listFavorites(config, before)
      if (!mounted.current) return
      setRows(prev => before ? prev.concat(got) : got); setDone(got.length < 40)
    } catch (e) { if (mounted.current) setError(e.message) }
    finally { if (mounted.current) setLoading(false) }
  }
  useEffect(() => { load() }, [config?.baseUrl, config?.apiToken])

  async function remove(row) {
    if (!await confirm({ title: '取消收藏？', description: '只是从收藏里拿掉，聊天记录还在。', confirmLabel: '取消收藏' })) return
    try { await removeFavorite(config, row); setRows(prev => prev.filter(r => r.id !== row.id)) } catch (e) { setError(e.message) }
  }
  async function note(row) {
    const v = window.prompt('给这条写一句（留空就是删掉）', row.note || '')
    if (v === null) return
    try { await noteFavorite(config, row.id, v.trim()); setRows(prev => prev.map(r => r.id === row.id ? { ...r, note: v.trim() } : r)) } catch (e) { setError(e.message) }
  }

  const shown = rows.filter(r => filter === 'all' || r.role === filter)
  return createPortal(<div className="photo-album-overlay" onClick={onClose}>
    <section className="photo-album fav-panel" role="dialog" aria-modal="true" aria-label="收藏" onClick={e => e.stopPropagation()}>
      <header className="photo-album-head"><div><h2><StarIcon />收藏</h2><p>归巢和言叽收下的，都在这一本</p></div><div className="photo-album-head-actions"><button onClick={onClose} aria-label="关闭收藏">×</button></div></header>
      <div className="fav-tabs">{[['all', '全部'], ['assistant', '他说的'], ['user', '我说的']].map(([k, t]) => <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{t}</button>)}</div>
      {error && <div className="photo-album-error" role="alert">{error}<button onClick={() => load()}>重试</button></div>}
      <div className="fav-list">
        {shown.map(r => <FavCard key={r.id} row={r} config={config} onRemove={remove} onNote={note} />)}
        {!loading && !shown.length && !error && <div className="photo-album-empty"><StarIcon size={40} /><p>{rows.length ? '这一栏还空着' : '还没有收藏。点消息底下的小星星就收进来了。'}</p></div>}
        {loading && <div className="photo-album-empty">翻一翻…</div>}
        {!loading && !done && rows.length > 0 && <button type="button" className="fav-more" onClick={() => load(rows[rows.length - 1].id)}>再往前</button>}
      </div>
    </section>
  </div>, document.body)
}
