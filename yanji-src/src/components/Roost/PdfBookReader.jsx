import { useState, useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { showToast } from '../Toast'
import { fetchBookChat, createBookChatMessage } from '../../api/moonMemory'
import { sendMessage } from '../../api/llm'
import { loadPdfBlob, savePdfBlob, openPdf } from '../../utils/pdfBooks'

// 原样 PDF（1023 她要的）：图文教程照原样一页页翻；看不懂的那页点「问阿言」，
// 只把这一页截成图连同她的问题送过来。不做实时同步，不点不花钱。
// PDF 文件只存在这台设备的 IndexedDB 里，服务器只有书名；随读随聊按页记（chapter_idx = 页码-1）。
const PAGE_KEY = 'bookread-pdf-page'
function loadPage(id) { try { return JSON.parse(localStorage.getItem(PAGE_KEY) || '{}')[id] || 1 } catch { return 1 } }
function savePage(id, n) { try { const all = JSON.parse(localStorage.getItem(PAGE_KEY) || '{}'); all[id] = n; localStorage.setItem(PAGE_KEY, JSON.stringify(all)) } catch { /* 记不住就从第一页开始 */ } }

export default function PdfBookReader({ book, cfg, onBack, onClose }) {
  const connections = useStore((s) => s.connections)
  const activeConnectionId = useStore((s) => s.activeConnectionId)
  const generationConfig = useStore((s) => s.generationConfig)
  const globalInstruction = useStore((s) => s.globalInstruction)
  const moonMemory = useStore((s) => s.moonMemory)
  const connection = connections.find((c) => c.id === activeConnectionId)

  const [pdf, setPdf] = useState(null)
  const [missing, setMissing] = useState(false)
  const [page, setPage] = useState(() => loadPage(book.id))
  const [zoom, setZoom] = useState(1)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const fileRef = useRef(null)
  const touchRef = useRef(null)
  const chatEndRef = useRef(null)

  async function load() {
    const blob = await loadPdfBlob(book.id).catch(() => null)
    if (!blob) { setMissing(true); return }
    try { setPdf(await openPdf(blob)); setMissing(false) } catch { setMissing(true) }
  }
  useEffect(() => { load() }, [book.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 换了设备或清了数据：PDF 不在这儿，让她再选一次同一个文件
  async function relink(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try { await savePdfBlob(book.id, file); await load() } catch { showToast('存不进这台设备', 'error') }
  }

  // 画当前页：宽度撑满，按屏幕像素密度画清楚（最多 2 倍，省内存）
  useEffect(() => {
    if (!pdf) return
    let cancelled = false, task = null
    ;(async () => {
      const n = Math.min(Math.max(1, page), pdf.numPages)
      const p = await pdf.getPage(n)
      if (cancelled) return
      const canvas = canvasRef.current, wrap = wrapRef.current
      if (!canvas || !wrap) return
      const base = p.getViewport({ scale: 1 })
      const cssW = Math.max(200, wrap.clientWidth - 16) * zoom   // 减掉左右 padding
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const vp = p.getViewport({ scale: cssW / base.width * dpr })
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height)
      canvas.style.width = Math.floor(vp.width / dpr) + 'px'
      canvas.style.height = Math.floor(vp.height / dpr) + 'px'
      task = p.render({ canvasContext: canvas.getContext('2d'), viewport: vp })
      try { await task.promise } catch { /* 翻太快被取消 */ }
    })()
    savePage(book.id, page)
    return () => { cancelled = true; try { task?.cancel() } catch { /* ignore */ } }
  }, [pdf, page, zoom, book.id])

  useEffect(() => {
    if (!chatOpen) return
    fetchBookChat(cfg, book.id, page - 1).then((list) => setChatMessages(Array.isArray(list) ? list : [])).catch(() => setChatMessages([]))
  }, [chatOpen, page, book.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { chatEndRef.current?.scrollIntoView({ block: 'end' }) }, [chatMessages, sending])

  function turn(d) {
    if (!pdf) return
    setPage((n) => Math.min(pdf.numPages, Math.max(1, n + d)))
    wrapRef.current?.scrollTo?.({ top: 0 })
  }

  // 送给我的那张图：另画一份，宽 1100 像素左右，够看清小字又不太大
  async function pageImage() {
    const p = await pdf.getPage(page)
    const base = p.getViewport({ scale: 1 })
    const vp = p.getViewport({ scale: Math.min(3, 1100 / base.width) })
    const c = document.createElement('canvas')
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height)
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
    await p.render({ canvasContext: ctx, viewport: vp }).promise
    return c.toDataURL('image/jpeg', 0.82)
  }

  async function send() {
    const content = chatInput.trim()
    if (!content || sending || !pdf) return
    if (!connection) { showToast('还没有选择模型连接', 'error'); return }
    setSending(true); setChatInput('')
    let saved = false
    try {
      const img = await pageImage()
      const mine = await createBookChatMessage(cfg, book.id, { chapter_idx: page - 1, role: 'user', content })
      saved = true
      const history = [...chatMessages, mine]
      setChatMessages(history)
      const result = await sendMessage({
        connection,
        model: connection.defaultModel,
        // 只有最新这条带图：之前问过的页不再重复送
        messages: history.map((m, i) => (i === history.length - 1
          ? { role: m.role, content: m.content, images: [img] }
          : { role: m.role, content: m.content })),
        systemPrompt: globalInstruction,
        dynamicContext: `阿颖在共读书架看《${book.title}》（原样 PDF，共 ${pdf.numPages} 页），现在是第 ${page} 页，她附上了这一页的截图，这是她看不懂、想让你带着读的地方。看图回答，先讲清这一页在说什么，再接她的问题；图里看不清的就直说。`,
        generationConfig,
        moonMemoryConfig: moonMemory,
        autoTools: false,
        cacheKey: `book-pdf-${book.id}-${page}`,
      })
      const reply = (result?.text || '').trim()
      if (!reply) throw new Error('模型没有返回内容')
      const hers = await createBookChatMessage(cfg, book.id, { chapter_idx: page - 1, role: 'assistant', content: reply })
      setChatMessages((prev) => [...prev, hers])
    } catch (e) {
      if (!saved) setChatInput(content)
      showToast(`没问成：${e?.message || e}`, 'error')
    } finally { setSending(false) }
  }

  return (
    <div className="roost-overlay bookread-reader-overlay" onClick={onClose}>
      <div className="roost-modal coread-modal coread-reader coread-reader-fullscreen" onClick={(e) => e.stopPropagation()}>
        <div className="roost-modal-header">
          <button className="coread-back" onClick={onBack}>‹ 书架</button>
          <span className="coread-reader-title">{book.title}</span>
          <div className="bookread-header-actions">
            {pdf && <button className="bookread-mode-toggle" onClick={() => setZoom((z) => (z === 1 ? 1.6 : z === 1.6 ? 2.2 : 1))} title="放大">{zoom === 1 ? '放大' : `${zoom}×`}</button>}
            <button className="roost-modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept=".pdf,application/pdf" hidden onChange={relink} />
        <div
          className="roost-modal-body bookread-pdf-body"
          ref={wrapRef}
          onTouchStart={(e) => { if (zoom === 1) touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
          onTouchEnd={(e) => {
            const t = touchRef.current; touchRef.current = null
            if (!t) return
            const dx = e.changedTouches[0].clientX - t.x, dy = e.changedTouches[0].clientY - t.y
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? 1 : -1)
          }}
        >
          {missing && (
            <div className="roost-empty">
              这本的 PDF 不在这台设备上（换了手机或清过数据）。<br />
              <button className="roost-btn" style={{ marginTop: 12 }} onClick={() => fileRef.current?.click()}>重新选一下这个 PDF</button>
            </div>
          )}
          {!missing && !pdf && <div className="roost-empty">翻开书页……</div>}
          <canvas ref={canvasRef} className="bookread-pdf-canvas" style={{ display: pdf ? 'block' : 'none' }} />
        </div>
        {pdf && (
          <div className="bookread-page-footer">
            <button onClick={() => turn(-1)} disabled={page <= 1} aria-label="上一页">‹</button>
            <span>{page} / {pdf.numPages}</span>
            <button className="bookread-page-tool bookread-page-chat" onClick={() => setChatOpen(true)}>问阿言</button>
            <button onClick={() => turn(1)} disabled={page >= pdf.numPages} aria-label="下一页">›</button>
          </div>
        )}
        {chatOpen && (
          <section className="bookread-chat-panel" onClick={(e) => e.stopPropagation()} aria-label="问阿言">
            <div className="bookread-chat-head">
              <span>第 {page} 页 · 问阿言</span>
              <button onClick={() => setChatOpen(false)} aria-label="收起">✕</button>
            </div>
            <div className="bookread-chat-stream">
              {chatMessages.length === 0 && <div className="bookread-chat-empty">哪里看不懂就问，发的时候会把这一页截图一起带给涟言。</div>}
              {chatMessages.map((m) => (
                <div key={m.id} className={'coread-msg ' + (m.role === 'user' ? 'mine' : 'hers')}>
                  <div className="coread-msg-role">{m.role === 'user' ? '阿颖' : '涟言'}</div>
                  <div className="coread-bubble">{m.content}</div>
                </div>
              ))}
              {sending && <div className="bookread-chat-thinking">涟言在看这一页……</div>}
              <div ref={chatEndRef} />
            </div>
            <div className="bookread-chat-compose">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder="这一页哪里看不懂？"
                rows={2}
                disabled={sending}
              />
              <button onClick={send} disabled={sending || !chatInput.trim()}>发送</button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
