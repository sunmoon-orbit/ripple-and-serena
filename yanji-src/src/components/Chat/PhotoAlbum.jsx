import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useToolMemory } from './ToolMemory'
import { albumImage, conversationCard, hideAlbumItem, listAlbum, prepareAlbumImage, saveAlbum } from '../../api/album'
import { useThemedConfirm } from '../ThemedConfirmDialog'

export function AlbumIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="3" width="16" height="18" rx="2"/><path d="M8 3v18M3 7h4M3 12h4M3 17h4M11 16l3-4 2 2 2-3"/><circle cx="13" cy="8" r="1"/></svg>
}

function PrivateImage({ config, item, thumbnail, ...props }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true; let objectUrl
    setUrl(''); setFailed(false)
    albumImage(config, item.id, thumbnail).then(blob => {
      if (!active) return
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [config.baseUrl, config.apiToken, item.id, thumbnail])
  return url ? <img {...props} src={url} alt={item.title || '收藏的图片'} decoding="async" /> : <div className="photo-album-image-state">{failed ? '图片加载失败，请重新打开' : '照片展开中…'}</div>
}

export default function PhotoAlbum({ onClose, messages = [] }) {
  const config = useToolMemory()
  const confirm = useThemedConfirm()
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)
  const [page, setPage] = useState(0)
  const [detail, setDetail] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(null)
  const [pickChat, setPickChat] = useState(false)
  const [selected, setSelected] = useState([])
  const fileRef = useRef(null)
  const swipe = useRef(null)
  const lastSwipe = useRef(0)
  const mounted = useRef(true)
  const epoch = useRef(0)
  const item = items[page]
  const sources = messages.filter(m => m.id && !m.streaming && ['user', 'assistant'].includes(m.role)).slice(-40)
  const connected = config?.enabled && config?.apiToken

  async function refresh() {
    const request = ++epoch.current
    setLoading(true); setError('')
    try {
      const result = await listAlbum(config)
      if (!mounted.current || request !== epoch.current) return
      setItems(result.items); setCursor(result.next_cursor); setPage(0); setDetail(false)
    } catch (e) { if (mounted.current && request === epoch.current) setError(e.message) }
    finally { if (mounted.current && request === epoch.current) setLoading(false) }
  }
  useEffect(() => {
    mounted.current = true
    refresh()
    const update = () => refresh()
    window.addEventListener('yanji-album-updated', update)
    return () => { mounted.current = false; epoch.current++; window.removeEventListener('yanji-album-updated', update) }
  }, [config?.baseUrl, config?.apiToken, config?.enabled])
  useEffect(() => {
    const close = event => {
      if (event.key !== 'Escape' || busy) return
      if (draft) setDraft(null)
      else if (pickChat) setPickChat(false)
      else if (detail) setDetail(false)
      else onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [detail, draft, pickChat, busy, onClose])

  async function turn(direction) {
    if (busy || loading || detail || draft || pickChat) return
    if (direction < 0) return setPage(p => Math.max(0, p - 1))
    if (page < items.length - 1) return setPage(p => p + 1)
    if (!cursor) return
    setBusy(true); setError('')
    try {
      const result = await listAlbum(config, cursor)
      setItems(previous => [...previous, ...result.items]); setCursor(result.next_cursor)
      if (result.items.length) setPage(p => p + 1)
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  async function prepare(file, source = 'upload') {
    setBusy(true); setError('')
    try { setDraft({ ...await prepareAlbumImage(file), title: '', description: '', author: '阿颖', source }) }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  async function keepDraft(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await saveAlbum(config, draft)
      setDraft(null); setPickChat(false); setSelected([])
      await refresh()
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  async function makeConversation() {
    setBusy(true); setError('')
    try {
      const image = await conversationCard(sources.filter(m => selected.includes(m.id)))
      setDraft({ ...image, title: '这一刻', description: '', author: '阿颖', source: 'conversation' })
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!await confirm({ title: '收起这张照片？', description: '从相册中移走，服务器保留记录，不会永久删除。', confirmLabel: '收起' })) return
    setBusy(true); setError('')
    try { await hideAlbumItem(config, item.id); await refresh() }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  return createPortal(<div className="photo-album-overlay" onClick={() => { if (!busy) onClose() }}>
    <section className="photo-album" role="dialog" aria-modal="true" aria-label="共同相册" onClick={e => e.stopPropagation()}>
      <header className="photo-album-head"><div><h2><AlbumIcon />相册</h2><p>把想留下的这一刻，翻给你看</p></div><button onClick={onClose} disabled={busy} aria-label="关闭相册">×</button></header>
      {error && <div className="photo-album-error" role="alert">{error}{!draft && !pickChat && <button onClick={refresh} disabled={busy || loading}>重试</button>}</div>}
      {draft ? <form className="photo-album-editor" onSubmit={keepDraft}>
        <img src={draft.thumb_data} alt="待收藏图片" />
        <label>名字<input autoFocus maxLength={80} required value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="给这一刻取个名字" /></label>
        <label>想记下的话<textarea maxLength={4000} rows={4} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="为什么想留下它？" /></label>
        <div className="photo-album-actions"><button type="button" onClick={() => setDraft(null)} disabled={busy}>返回</button><button type="submit" disabled={busy || !draft.title.trim()}>{busy ? '收藏中…' : '收入相册'}</button></div>
      </form> : pickChat ? <div className="photo-album-chat-picker">
        <p>点图片收藏原图；勾选 1–8 条消息生成对话纪念卡。</p>
        <div className="photo-album-chat-list">{sources.length === 0 && <p>当前聊天还没有可收藏的消息。</p>}{sources.map(m => <div key={m.id}>
          <label><input type="checkbox" checked={selected.includes(m.id)} disabled={busy || (!selected.includes(m.id) && selected.length >= 8)} onChange={e => setSelected(previous => e.target.checked ? [...previous, m.id] : previous.filter(id => id !== m.id))} /><span>{m.role === 'user' ? '我' : '你'}：{String(m.content || '〔图片〕').slice(0, 140)}</span></label>
          {!!m.images?.length && <div className="photo-album-chat-images">{m.images.map((src, index) => <button key={index} disabled={busy} title="收藏这张图片" aria-label="收藏这张图片" onClick={async () => {
            if (!src.startsWith('data:image/')) { setError('此图片无法直接读取，请保存到手机后上传'); return }
            try { await prepare(await (await fetch(src)).blob(), 'chat') } catch { setError('图片读取失败') }
          }}><img src={src} alt={`聊天图片 ${index + 1}`} loading="lazy" /></button>)}</div>}
        </div>)}</div>
        <div className="photo-album-actions"><button onClick={() => setPickChat(false)} disabled={busy}>返回相册</button><button onClick={makeConversation} disabled={!selected.length || busy}>收藏对话（{selected.length}）</button></div>
      </div> : detail && item ? <div className="photo-album-detail">
        <button className="photo-album-back" onClick={() => setDetail(false)}>‹ 返回翻页</button>
        <div className="photo-album-full-image"><PrivateImage config={config} item={item} /></div>
        <h3>{item.title}</h3><p>{item.description || '这一刻，无需多说。'}</p>
        <small>{item.author} 收藏 · {new Date(item.created_at).toLocaleDateString('zh-CN')}</small>
        {item.source_url && /^https:\/\//i.test(item.source_url) && <a href={item.source_url} target="_blank" rel="noopener noreferrer">查看原始来源 ↗</a>}
        <button className="photo-album-back" onClick={remove} disabled={busy}>从相册收起</button>
      </div> : <>
        <div className="photo-album-book" onTouchStart={e => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }} onTouchCancel={() => { swipe.current = null }} onTouchEnd={e => {
          const start = swipe.current; swipe.current = null
          if (!start || !e.changedTouches[0]) return
          const dx = e.changedTouches[0].clientX - start.x; const dy = e.changedTouches[0].clientY - start.y
          if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) { lastSwipe.current = Date.now(); turn(dx < 0 ? 1 : -1) }
        }}>
          {loading ? <div className="photo-album-empty">正在翻开相册…</div> : item ? <button key={item.id} className="photo-album-page" onClick={() => { if (Date.now() - lastSwipe.current > 350) setDetail(true) }} aria-label={`展开：${item.title}`}>
            <div className="photo-album-thumb"><PrivateImage config={config} item={item} thumbnail /></div><h3>{item.title}</h3><p>{item.description || '这一刻，无需多说。'}</p><small>{item.author} 收藏 · 点照片看详情</small>
          </button> : <div className="photo-album-empty"><AlbumIcon size={44} /><p>{error ? '还没能打开相册' : '第一页，等一张想留下的照片。'}</p></div>}
        </div>
        <nav className="photo-album-pager" aria-label="相册翻页"><button onClick={() => turn(-1)} disabled={page === 0 || busy || loading} aria-label="上一张">‹</button><span aria-live="polite">{items.length ? page + 1 : 0} / {items.length}{cursor ? '+' : ''}</span><button onClick={() => turn(1)} disabled={busy || loading || (!cursor && page >= items.length - 1)} aria-label="下一张">›</button></nav>
        <div className="photo-album-actions"><button onClick={() => fileRef.current?.click()} disabled={!connected || busy}>从手机选照片</button><button onClick={() => { setError(''); setPickChat(true) }} disabled={!connected || busy}>收藏聊天</button></div>
      </>}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) prepare(file) }} />
    </section>
  </div>, document.body)
}
