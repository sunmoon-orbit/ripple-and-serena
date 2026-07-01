import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '../../store'
import { showToast } from '../Toast'
import {
  fetchBooks, fetchBookChapter,
  createBookAnnotation, deleteBookAnnotation, saveBookBookmark,
} from '../../api/moonMemory'

const COLORS = [
  { id: 'yellow', hex: '#f5d76e' },
  { id: 'pink', hex: '#f0a6c0' },
  { id: 'blue', hex: '#9ec5e8' },
  { id: 'green', hex: '#a8d8b0' },
]
const COLOR_HEX = Object.fromEntries(COLORS.map((c) => [c.id, c.hex]))

// 把章节正文按标注偏移切成段：每段带覆盖它的标注列表（正文渲染必须与原文逐字一致，偏移才准）
function buildSegments(content, annos) {
  const points = new Set([0, content.length])
  for (const a of annos) {
    points.add(Math.max(0, Math.min(a.start_off, content.length)))
    points.add(Math.max(0, Math.min(a.end_off, content.length)))
  }
  const sorted = [...points].sort((x, y) => x - y)
  const segs = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const [s, e] = [sorted[i], sorted[i + 1]]
    if (s >= e) continue
    const covering = annos.filter((a) => a.start_off <= s && a.end_off >= e)
    segs.push({ start: s, text: content.slice(s, e), annos: covering })
  }
  return segs
}

export default function BookRead({ onClose }) {
  const moonMemory = useStore((s) => s.moonMemory)
  const cfg = { baseUrl: (moonMemory?.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, ''), apiToken: moonMemory?.apiToken }

  const [books, setBooks] = useState(null)      // null=loading
  const [active, setActive] = useState(null)    // 选中的书（列表项）
  const [chapter, setChapter] = useState(null)  // {idx,title,content,annotations}
  const [chapterCount, setChapterCount] = useState(1)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(null)  // 选中待批注 {start,end,quote}
  const [composing, setComposing] = useState(false)
  const [annoColor, setAnnoColor] = useState('yellow')
  const [annoNote, setAnnoNote] = useState('')
  const [annoAuthor, setAnnoAuthor] = useState('阿颖')
  const [focusAnno, setFocusAnno] = useState(null) // 点了正文划线 → 高亮下方对应批注卡
  const textRef = useRef(null)
  const annoRefs = useRef({})

  useEffect(() => {
    if (!cfg.apiToken) { setBooks([]); return }
    fetchBooks(cfg).then((list) => setBooks(Array.isArray(list) ? list : [])).catch(() => setBooks([]))
  }, [])

  const openChapter = useCallback(async (book, idx) => {
    setLoading(true)
    setPending(null); setComposing(false); setFocusAnno(null)
    try {
      const ch = await fetchBookChapter(cfg, book.id, idx)
      setChapter(ch)
    } catch { showToast('章节加载失败', 'error') } finally { setLoading(false) }
  }, [])

  async function openBook(book) {
    setActive(book)
    setChapterCount(book.chapter_count || 1)
    // 有共享书签就从书签章节接着读
    await openChapter(book, book.bookmark_chapter ?? 0)
  }

  // 监听正文里的文字选择 → 算出章内字符偏移（渲染文本与原文逐字一致，直接数长度）
  useEffect(() => {
    if (!chapter) return
    function onSelChange() {
      if (composing) return // 批注浮层打开时锁定当前选区
      const sel = window.getSelection()
      const el = textRef.current
      if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return
      const range = sel.getRangeAt(0)
      if (!el.contains(range.commonAncestorContainer)) return
      const pre = range.cloneRange()
      pre.selectNodeContents(el)
      pre.setEnd(range.startContainer, range.startOffset)
      const start = pre.toString().length
      const quote = range.toString()
      if (!quote.trim()) return
      setPending({ start, end: start + quote.length, quote })
    }
    document.addEventListener('selectionchange', onSelChange)
    return () => document.removeEventListener('selectionchange', onSelChange)
  }, [chapter, composing])

  async function submitAnno() {
    if (!pending) return
    try {
      const created = await createBookAnnotation(cfg, active.id, {
        chapter_idx: chapter.idx,
        start_off: pending.start,
        end_off: pending.end,
        quote: pending.quote.slice(0, 200),
        author: annoAuthor,
        color: annoColor,
        note: annoNote.trim(),
      })
      setChapter((prev) => ({ ...prev, annotations: [...prev.annotations, created].sort((a, b) => a.start_off - b.start_off) }))
      setPending(null); setComposing(false); setAnnoNote(''); setAnnoColor('yellow')
      window.getSelection()?.removeAllRanges()
      showToast('划下了这一句')
    } catch { showToast('批注失败', 'error') }
  }

  async function removeAnno(id) {
    try {
      await deleteBookAnnotation(cfg, id)
      setChapter((prev) => ({ ...prev, annotations: prev.annotations.filter((a) => a.id !== id) }))
      setFocusAnno(null)
    } catch { showToast('删除失败', 'error') }
  }

  async function markBookmark() {
    try {
      await saveBookBookmark(cfg, active.id, chapter.idx, '阿颖')
      showToast('书签夹在这一章了')
    } catch { showToast('书签保存失败', 'error') }
  }

  function jumpToAnno(id) {
    setFocusAnno(id)
    annoRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // ── 书架视图 ──
  if (!active) {
    return (
      <div className="roost-overlay" onClick={onClose}>
        <div className="roost-modal roost-modal-tall coread-modal" onClick={(e) => e.stopPropagation()}>
          <div className="roost-modal-header">
            <span>书架 · 一起读一本书</span>
            <button className="roost-modal-close" onClick={onClose}>✕</button>
          </div>
          <div className="roost-modal-body">
            {books === null && <div className="roost-empty">加载中……</div>}
            {books?.length === 0 && <div className="roost-empty">书架还空着（跟阿言说一声想读什么，我来上架）</div>}
            <div className="bookread-shelf">
              {books?.map((b) => (
                <div key={b.id} className="bookread-book" onClick={() => openBook(b)}>
                  <div className="bookread-spine" style={{ background: b.cover_color || '#8b6f47' }} />
                  <div className="bookread-book-main">
                    <div className="bookread-book-title">{b.title}<span className="bookread-book-author">{b.author}</span></div>
                    {b.intro && <div className="bookread-book-intro">{b.intro}</div>}
                    <div className="bookread-book-meta">
                      <span>{b.chapter_count} 章</span>
                      <span>{b.anno_count > 0 ? `${b.anno_count} 处划线` : '还没有划线'}</span>
                      {b.bookmark_chapter != null && <span>书签在第 {b.bookmark_chapter + 1} 章</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── 阅读视图 ──
  const annos = chapter?.annotations || []
  const segs = chapter ? buildSegments(chapter.content, annos) : []

  return (
    <div className="roost-overlay" onClick={onClose}>
      <div className="roost-modal roost-modal-tall coread-modal coread-reader" onClick={(e) => e.stopPropagation()}>
        <div className="roost-modal-header">
          <button className="coread-back" onClick={() => { setActive(null); setChapter(null); setPending(null); setComposing(false) }}>‹ 书架</button>
          <span className="coread-reader-title">{active.title}</span>
          <button className="roost-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="roost-modal-body">
          {loading && <div className="roost-empty">翻开书页……</div>}
          {!loading && chapter && (
            <>
              <div className="bookread-chapter-bar">
                <button disabled={chapter.idx <= 0} onClick={() => openChapter(active, chapter.idx - 1)}>‹ 上一章</button>
                <span className="bookread-chapter-name">{chapter.title || `第 ${chapter.idx + 1} 章`}</span>
                <button disabled={chapter.idx >= chapterCount - 1} onClick={() => openChapter(active, chapter.idx + 1)}>下一章 ›</button>
              </div>
              <div className="bookread-text" ref={textRef}>
                {segs.map((s) =>
                  s.annos.length ? (
                    <mark
                      key={s.start}
                      className="bookread-mark"
                      style={{ backgroundColor: (COLOR_HEX[s.annos[0].color] || '#f5d76e') + '66', borderBottom: `2px solid ${COLOR_HEX[s.annos[0].color] || '#f5d76e'}` }}
                      onClick={() => jumpToAnno(s.annos[0].id)}
                    >{s.text}</mark>
                  ) : (
                    <span key={s.start}>{s.text}</span>
                  )
                )}
              </div>
              <div className="bookread-foot">
                <button className="roost-btn roost-btn-ghost roost-btn-sm" onClick={markBookmark}>夹书签</button>
                <span className="bookread-foot-hint">长按选中一句话，就能划线批注</span>
              </div>
              {annos.length > 0 && (
                <div className="bookread-anno-list">
                  <div className="roost-card-label" style={{ marginBottom: 8 }}>划线与批注</div>
                  {annos.map((a) => (
                    <div
                      key={a.id}
                      ref={(el) => { annoRefs.current[a.id] = el }}
                      className={'bookread-anno-card' + (focusAnno === a.id ? ' focus' : '')}
                      style={{ borderLeftColor: COLOR_HEX[a.color] || '#f5d76e' }}
                    >
                      <div className="bookread-anno-quote">「{a.quote}」</div>
                      <div className="bookread-anno-row">
                        <span className="coread-anno-author">{a.author}</span>
                        <span className="coread-anno-note">{a.note || '（划线）'}</span>
                        <button className="coread-anno-del" onClick={() => removeAnno(a.id)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* 选中文字 → 浮出划线入口 */}
        {pending && !composing && (
          <div className="bookread-pending" onClick={(e) => e.stopPropagation()}>
            <span className="bookread-pending-quote">「{pending.quote.length > 24 ? pending.quote.slice(0, 24) + '…' : pending.quote}」</span>
            <button className="roost-btn roost-btn-sm" onClick={() => setComposing(true)}>划线批注</button>
          </div>
        )}

        {/* 批注浮层（复用共读样式） */}
        {pending && composing && (
          <div className="coread-anno-compose" onClick={(e) => e.stopPropagation()}>
            <div className="bookread-anno-quote">「{pending.quote.length > 60 ? pending.quote.slice(0, 60) + '…' : pending.quote}」</div>
            <div className="coread-color-row">
              {COLORS.map((c) => (
                <button
                  key={c.id}
                  className={'coread-color-dot' + (annoColor === c.id ? ' active' : '')}
                  style={{ background: c.hex }}
                  onClick={() => setAnnoColor(c.id)}
                />
              ))}
              <div className="bookread-author-toggle">
                {['阿颖', '涟言'].map((who) => (
                  <button key={who} className={annoAuthor === who ? 'active' : ''} onClick={() => setAnnoAuthor(who)}>{who}</button>
                ))}
              </div>
            </div>
            <textarea
              className="coread-anno-input"
              placeholder="写一句批注（留空＝纯划线）……"
              value={annoNote}
              onChange={(e) => setAnnoNote(e.target.value)}
              rows={2}
              autoFocus
            />
            <div className="coread-anno-actions">
              <button className="roost-btn roost-btn-ghost roost-btn-sm" onClick={() => { setPending(null); setComposing(false); window.getSelection()?.removeAllRanges() }}>取消</button>
              <button className="roost-btn roost-btn-sm" onClick={submitAnno}>留下</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
