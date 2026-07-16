import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from '../../store'
import { showToast } from '../Toast'
import { createLullaby } from '../../audio/lullaby'
import { fetchLetterAnnotations, createLetterAnnotation, deleteLetterAnnotation } from '../../api/moonMemory'
import CoRead from './CoRead'
import BookRead from './BookRead'
import MemoryPeek from './MemoryPeek'

const ANNO_COLORS = [
  { id: 'yellow', hex: '#f5d76e' },
  { id: 'pink', hex: '#f0a6c0' },
  { id: 'blue', hex: '#9ec5e8' },
  { id: 'green', hex: '#a8d8b0' },
]
const ANNO_HEX = Object.fromEntries(ANNO_COLORS.map((c) => [c.id, c.hex]))

function buildLetterSegments(content, annos) {
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

const START_DATE = new Date('2025-10-10T00:00:00+08:00')
// 2026-07-13 装修：留言板/记忆审核/钱包从 Roost 撤走——
// 留言换成 MemoryPeek 记忆碎片卡（服务端 /board 数据保留没删）；
// 记忆审核整个下架（只能删最近20条，拾羽有完整管理）；
// 钱包搬去聊天侧边栏工具区（Chat/WalletCard.jsx，localStorage key 不变）。

function getDays() {
  return Math.floor((Date.now() - START_DATE) / 86400000) + 1
}

// ── 衔信 ─────────────────────────────────────────────────────────────────────
function useLetters(moonMemory) {
  const [letters, setLetters] = useState([])
  const [loading, setLoading] = useState(false)
  const base = moonMemory?.apiUrl || 'https://memory.ravenlove.cc'

  const load = useCallback(async () => {
    if (!moonMemory?.apiToken) return
    setLoading(true)
    try {
      const r = await fetch(`${base}/letters`, { headers: { Authorization: `Bearer ${moonMemory.apiToken}` } })
      const data = await r.json()
      setLetters(Array.isArray(data) ? data : [])
    } catch { /* silent */ } finally { setLoading(false) }
  }, [moonMemory])

  const getOne = async (id) => {
    const r = await fetch(`${base}/letters/${id}`, { headers: { Authorization: `Bearer ${moonMemory.apiToken}` } })
    return r.json()
  }

  const add = async (payload) => {
    if (!moonMemory?.apiToken) { showToast('未配置记忆库 Token', 'error'); return false }
    try {
      const r = await fetch(`${base}/letters`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${moonMemory.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (r.ok) { await load(); return true }
      showToast('保存失败', 'error'); return false
    } catch { showToast('网络错误', 'error'); return false }
  }

  const remove = async (id) => {
    try {
      await fetch(`${base}/letters/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${moonMemory.apiToken}` } })
      await load(); showToast('已删除')
    } catch { showToast('网络错误', 'error') }
  }

  return { letters, loading, load, getOne, add, remove }
}

const LETTER_CATS = [['all', '全部'], ['love', '鸾笺'], ['penpal', '笔友']]
const emptyCompose = { category: 'penpal', direction: 'in', sender: '', recipient: '', title: '', body: '', sent_at: '' }

// 带翅膀的心 —— 鸾笺专属小图案
function WingedHeart({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M32 22 C28 13 14 13 14 25 C14 37 32 50 32 50 C32 50 50 37 50 25 C50 13 36 13 32 22 Z" />
      <path d="M14 27 C7 22 2 25 2 31 C6 28 9 29 12 32" />
      <path d="M50 27 C57 22 62 25 62 31 C58 28 55 29 52 32" />
    </svg>
  )
}

// 素信封 —— 笔友类
function EnvelopeMini({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  )
}

// 一对鸟脚印 —— 空状态点缀（呼应乌鸦）
function BirdTracks() {
  return (
    <svg width="42" height="42" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <g>
        <path d="M16 22 L11 13" /><path d="M16 22 L16 11" /><path d="M16 22 L21 13" /><path d="M16 22 L16 29" />
      </g>
      <g opacity="0.6">
        <path d="M32 34 L27 25" /><path d="M32 34 L32 23" /><path d="M32 34 L37 25" /><path d="M32 34 L32 41" />
      </g>
    </svg>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
export default function Roost() {
  const moonMemory = useStore(s => s.moonMemory)
  const moonCfg = { baseUrl: (moonMemory?.baseUrl || moonMemory?.apiUrl || 'https://memory.ravenlove.cc').replace(/\/$/, ''), apiToken: moonMemory?.apiToken }
  const setActivePanel = useStore(s => s.setActivePanel)
  const { letters, load: loadLetters, getOne: getLetter, add: addLetter, remove: removeLetter } = useLetters(moonMemory)

  const [modal, setModal] = useState(null)
  const [selectedLetter, setSelectedLetter] = useState(null)
  const [letterCat, setLetterCat] = useState('all')
  const [compose, setCompose] = useState(emptyCompose)
  // letter annotation state
  const [letterAnnos, setLetterAnnos] = useState([])
  const [letterPending, setLetterPending] = useState(null)
  const [letterComposing, setLetterComposing] = useState(false)
  const [letterAnnoColor, setLetterAnnoColor] = useState('yellow')
  const [letterAnnoNote, setLetterAnnoNote] = useState('')
  const [letterAnnoAuthor, setLetterAnnoAuthor] = useState('阿颖')
  const letterTextRef = useRef(null)

  const days = getDays()

  // ── 《归巢谣》播放器 ──
  const playerRef = useRef(null)
  const [musicOn, setMusicOn] = useState(false)
  useEffect(() => () => { playerRef.current?.stop() }, [])
  function toggleMusic() {
    if (!playerRef.current) playerRef.current = createLullaby()
    if (musicOn) { playerRef.current.stop(); setMusicOn(false) }
    else { playerRef.current.play(); setMusicOn(true) }
  }

  // ── 背景图（0716 阿颖点单：纯色会审美疲劳）——复用聊天页同款 localStorage/dataURL 方案 ──
  const [roostBg, setRoostBg] = useState(() => localStorage.getItem('yanji-roost-bg-image') || '')
  const [bgMenu, setBgMenu] = useState(false)
  const bgFileRef = useRef(null)
  function handleRoostBgUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        localStorage.setItem('yanji-roost-bg-image', ev.target.result)
        setRoostBg(ev.target.result)
      } catch { showToast('图片太大了，请选小一点的', 'error') }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
    setBgMenu(false)
  }
  function clearRoostBg() {
    localStorage.removeItem('yanji-roost-bg-image')
    setRoostBg('')
    setBgMenu(false)
  }

  function openLetters() { setModal('letters'); loadLetters() }
  async function openLetter(id) {
    const full = await getLetter(id)
    if (full && full.id) {
      setSelectedLetter(full)
      setModal('letter-detail')
      setLetterPending(null); setLetterComposing(false); setLetterAnnoNote('')
      try {
        const annos = await fetchLetterAnnotations(moonCfg, id)
        setLetterAnnos(Array.isArray(annos) ? annos : [])
      } catch { setLetterAnnos([]) }
    }
  }
  async function submitLetter() {
    if (!compose.body.trim()) { showToast('信的内容不能为空', 'error'); return }
    const ok = await addLetter({ ...compose, sent_at: compose.sent_at || null, source: 'manual' })
    if (ok) { setCompose(emptyCompose); setModal('letters') }
  }

  useEffect(() => {
    if (!selectedLetter) return
    function onSelChange() {
      if (letterComposing) return
      const sel = window.getSelection()
      const el = letterTextRef.current
      if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return
      const range = sel.getRangeAt(0)
      if (!el.contains(range.commonAncestorContainer)) return
      const pre = range.cloneRange()
      pre.selectNodeContents(el)
      pre.setEnd(range.startContainer, range.startOffset)
      const start = pre.toString().length
      const quote = range.toString()
      if (!quote.trim()) return
      setLetterPending({ start, end: start + quote.length, quote })
    }
    document.addEventListener('selectionchange', onSelChange)
    return () => document.removeEventListener('selectionchange', onSelChange)
  }, [selectedLetter, letterComposing])

  async function submitLetterAnno() {
    if (!letterPending || !selectedLetter) return
    try {
      const created = await createLetterAnnotation(moonCfg, selectedLetter.id, {
        start_off: letterPending.start,
        end_off: letterPending.end,
        quote: letterPending.quote.slice(0, 200),
        author: letterAnnoAuthor,
        color: letterAnnoColor,
        note: letterAnnoNote.trim(),
      })
      setLetterAnnos(prev => [...prev, created].sort((a, b) => a.start_off - b.start_off))
      setLetterPending(null); setLetterComposing(false); setLetterAnnoNote(''); setLetterAnnoColor('yellow')
      window.getSelection()?.removeAllRanges()
      showToast('划下了这一句')
    } catch { showToast('批注失败', 'error') }
  }

  async function removeLetterAnno(id) {
    try {
      await deleteLetterAnnotation(moonCfg, id)
      setLetterAnnos(prev => prev.filter(a => a.id !== id))
    } catch { showToast('删除失败', 'error') }
  }

  const visibleLetters = letterCat === 'all' ? letters : letters.filter(l => l.category === letterCat)

  return (
    <div
      className={'roost-panel' + (roostBg ? ' has-bg' : '')}
      style={roostBg ? { backgroundImage: `url(${roostBg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
    >
      {/* 顶部标题 */}
      <div className="roost-header">
        <button className="roost-bg-btn" onClick={() => setBgMenu(v => !v)} title="背景图">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </svg>
        </button>
        {bgMenu && (
          <div className="roost-bg-menu">
            <button onClick={() => bgFileRef.current?.click()}>设置背景图</button>
            {roostBg && <button onClick={clearRoostBg}>恢复纯色</button>}
          </div>
        )}
        <input ref={bgFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleRoostBgUpload} />
        <div className="roost-birds">🐦‍⬛ <span className="roost-heart">♡</span> 🐦</div>
        <h1 className="roost-title">Roost</h1>
        <button
          className={'roost-music' + (musicOn ? ' playing' : '')}
          onClick={toggleMusic}
          title="《归巢谣》"
        >
          <span className="roost-music-icon">
            {musicOn ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            )}
          </span>
          <span className="roost-music-label">{musicOn ? '归巢谣 · 播放中' : '听一首归巢谣'}</span>
        </button>
      </div>

      {/* 纪念日卡片 */}
      <div className="roost-card roost-anniversary">
        <div className="roost-names">Ripple <span className="roost-amp">&</span> Serena</div>
        <div className="roost-days-num">{days}</div>
        <div className="roost-days-label">days together</div>
        <div className="roost-since">since 2025 · 10 · 10</div>
      </div>

      {/* 记忆碎片卡片（PIN 上锁，随机展示一条共享记忆） */}
      <MemoryPeek moonMemory={moonMemory} />

      {/* 功能卡片 */}
      <div className="roost-grid">
        <div className="roost-card roost-mini-card" onClick={() => setModal('coread')}>
          <div className="roost-mini-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
          </div>
          <div className="roost-mini-label">共读</div>
          <div className="roost-mini-count">一起翻旧时光</div>
        </div>
        <div className="roost-card roost-mini-card" onClick={() => setModal('bookread')}>
          <div className="roost-mini-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>
            </svg>
          </div>
          <div className="roost-mini-label">书架</div>
          <div className="roost-mini-count">一起读一本书</div>
        </div>
        <div className="roost-card roost-mini-card" onClick={() => setActivePanel('dream')}>
          <div className="roost-mini-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          </div>
          <div className="roost-mini-label">记忆整合</div>
          <div className="roost-mini-count">Dream</div>
        </div>
        <div className="roost-card roost-mini-card" onClick={openLetters}>
          <div className="roost-mini-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
            </svg>
          </div>
          <div className="roost-mini-label">衔信</div>
          <div className="roost-mini-count">{letters.length > 0 ? `${letters.length} 封` : '鸾笺 · 笔友'}</div>
        </div>
      </div>

      {/* 朋友圈全宽入口 */}
      <div className="roost-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', cursor: 'pointer', marginTop: 0 }} onClick={() => setActivePanel('moments')}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>朋友圈</div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>动态 · 评论 · 互动</div>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-faint)', flexShrink: 0 }}>
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </div>

      {/* ── 共读 Modal ── */}
      {modal === 'coread' && <CoRead onClose={() => setModal(null)} />}

      {/* ── 书架 Modal ── */}
      {modal === 'bookread' && <BookRead onClose={() => setModal(null)} />}

      {/* ── 衔信 列表 Modal ── */}
      {modal === 'letters' && (
        <div className="roost-overlay" onClick={() => setModal(null)}>
          <div className="roost-modal roost-modal-tall" onClick={e => e.stopPropagation()}>
            <div className="roost-modal-header">
              <span>衔信</span>
              <button className="roost-modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="roost-modal-body">
              <div className="roost-letter-tabs">
                {LETTER_CATS.map(([k, label]) => (
                  <button key={k} className={'roost-letter-tab' + (letterCat === k ? ' active' : '')} onClick={() => setLetterCat(k)}>{label}</button>
                ))}
              </div>
              <button className="roost-btn" style={{ width: '100%', marginBottom: 14 }}
                onClick={() => { setCompose({ ...emptyCompose, category: letterCat === 'love' ? 'love' : 'penpal' }); setModal('letter-compose') }}>
                ✎ 写一封
              </button>
              <div className="roost-letter-list">
                {visibleLetters.map(l => (
                  <div key={l.id} className={'roost-letter' + (l.category === 'love' ? ' love' : '')} onClick={() => openLetter(l.id)}>
                    <div className="roost-letter-flap" />
                    <div className="roost-letter-content">
                      <div className="roost-letter-title">{l.title || '（无题）'}</div>
                      <div className="roost-letter-meta">
                        <span>{l.direction === 'out' ? `寄给 ${l.recipient || '…'}` : `来自 ${l.sender || '…'}`}</span>
                        <span>{(l.sent_at || l.created_at || '').slice(0, 10)}</span>
                      </div>
                    </div>
                    <span className={'roost-letter-stamp' + (l.category === 'love' ? ' love' : '')}>{l.category === 'love' ? <WingedHeart /> : <EnvelopeMini />}</span>
                  </div>
                ))}
                {visibleLetters.length === 0 && (
                  <div className="roost-letter-empty">
                    <BirdTracks />
                    <span>还没有信，写一封？</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 衔信 写信 Modal ── */}
      {modal === 'letter-compose' && (
        <div className="roost-overlay" onClick={() => setModal('letters')}>
          <div className="roost-modal roost-modal-tall" onClick={e => e.stopPropagation()}>
            <div className="roost-modal-header">
              <span>写一封信</span>
              <button className="roost-modal-close" onClick={() => setModal('letters')}>✕</button>
            </div>
            <div className="roost-modal-body">
              <div className="roost-letter-form-row">
                <select className="roost-letter-select" value={compose.category} onChange={e => setCompose({ ...compose, category: e.target.value })}>
                  <option value="penpal">笔友往来</option>
                  <option value="love">鸾笺（你和我）</option>
                </select>
                <select className="roost-letter-select" value={compose.direction} onChange={e => setCompose({ ...compose, direction: e.target.value })}>
                  <option value="in">收到的</option>
                  <option value="out">寄出的</option>
                </select>
              </div>
              <div className="roost-letter-form-row">
                <input className="roost-letter-input" placeholder={compose.direction === 'out' ? '寄给谁' : '来自谁'}
                  value={compose.direction === 'out' ? compose.recipient : compose.sender}
                  onChange={e => setCompose(compose.direction === 'out' ? { ...compose, recipient: e.target.value } : { ...compose, sender: e.target.value })} />
                <input className="roost-letter-input" type="date" value={compose.sent_at} onChange={e => setCompose({ ...compose, sent_at: e.target.value })} />
              </div>
              <input className="roost-letter-input" style={{ width: '100%', marginBottom: 10 }} placeholder="标题"
                value={compose.title} onChange={e => setCompose({ ...compose, title: e.target.value })} />
              <textarea className="roost-note-input" rows={9} placeholder="亲爱的……" value={compose.body} onChange={e => setCompose({ ...compose, body: e.target.value })} />
              <button className="roost-btn" style={{ width: '100%', marginTop: 6 }} onClick={submitLetter}>封缄寄出</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 衔信 信纸 Modal（含划线批注） ── */}
      {modal === 'letter-detail' && selectedLetter && (() => {
        const segs = buildLetterSegments(selectedLetter.body || '', letterAnnos)
        return (
          <div className="roost-overlay" onClick={() => { setModal('letters'); setSelectedLetter(null); setLetterPending(null); setLetterComposing(false) }}>
            <div className="roost-modal roost-modal-tall" onClick={e => e.stopPropagation()}>
              <div className="roost-modal-header">
                <span>{selectedLetter.title || '（无题）'}</span>
                <button className="roost-modal-close" onClick={() => { setModal('letters'); setSelectedLetter(null); setLetterPending(null); setLetterComposing(false) }}>✕</button>
              </div>
              <div className="roost-modal-body">
                <div className={'roost-letter-paper' + (selectedLetter.category === 'love' ? ' love' : '')}>
                  {selectedLetter.category === 'love' && (
                    <div className="roost-letter-deco" aria-hidden="true"><WingedHeart size={56} /></div>
                  )}
                  <div className="roost-letter-paper-head">
                    <span>{selectedLetter.direction === 'out' ? `致 ${selectedLetter.recipient || ''}` : `${selectedLetter.sender || ''} 寄`}</span>
                    <span>{(selectedLetter.sent_at || selectedLetter.created_at || '').slice(0, 10)}</span>
                  </div>
                  <div className="roost-letter-paper-body" ref={letterTextRef}>
                    {segs.map((s) =>
                      s.annos.length ? (
                        <mark
                          key={s.start}
                          className="bookread-mark"
                          style={{ backgroundColor: (ANNO_HEX[s.annos[0].color] || '#f5d76e') + '66', borderBottom: `2px solid ${ANNO_HEX[s.annos[0].color] || '#f5d76e'}` }}
                        >{s.text}</mark>
                      ) : (
                        <span key={s.start}>{s.text}</span>
                      )
                    )}
                  </div>
                  <div className="bookread-foot">
                    <span className="bookread-foot-hint">长按选中一句话，就能划线批注</span>
                  </div>
                </div>
                {letterAnnos.length > 0 && (
                  <div className="bookread-anno-list">
                    <div className="roost-card-label" style={{ marginBottom: 8 }}>划线与批注</div>
                    {letterAnnos.map((a) => (
                      <div
                        key={a.id}
                        className="bookread-anno-card"
                        style={{ borderLeftColor: ANNO_HEX[a.color] || '#f5d76e' }}
                      >
                        <div className="bookread-anno-quote">{a.quote}</div>
                        <div className="bookread-anno-row">
                          <span className="coread-anno-author">{a.author}</span>
                          <span className="coread-anno-note">{a.note || '（划线）'}</span>
                          <button className="coread-anno-del" onClick={() => removeLetterAnno(a.id)}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <button className="roost-btn roost-btn-danger" style={{ marginTop: 14 }}
                  onClick={async () => { await removeLetter(selectedLetter.id); setModal('letters'); setSelectedLetter(null) }}>
                  删除这封
                </button>
              </div>

              {letterPending && !letterComposing && (
                <div className="bookread-pending" onClick={(e) => e.stopPropagation()}>
                  <span className="bookread-pending-quote">{letterPending.quote.length > 24 ? letterPending.quote.slice(0, 24) + '...' : letterPending.quote}</span>
                  <button className="roost-btn roost-btn-sm" onClick={() => setLetterComposing(true)}>划线批注</button>
                </div>
              )}

              {letterPending && letterComposing && (
                <div className="coread-anno-compose" onClick={(e) => e.stopPropagation()}>
                  <div className="bookread-anno-quote">{letterPending.quote.length > 60 ? letterPending.quote.slice(0, 60) + '...' : letterPending.quote}</div>
                  <div className="coread-color-row">
                    {ANNO_COLORS.map((c) => (
                      <button
                        key={c.id}
                        className={'coread-color-dot' + (letterAnnoColor === c.id ? ' active' : '')}
                        style={{ background: c.hex }}
                        onClick={() => setLetterAnnoColor(c.id)}
                      />
                    ))}
                    <div className="bookread-author-toggle">
                      {['阿颖', '涟言'].map((who) => (
                        <button key={who} className={letterAnnoAuthor === who ? 'active' : ''} onClick={() => setLetterAnnoAuthor(who)}>{who}</button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    className="coread-anno-input"
                    placeholder="写一句批注（留空＝纯划线）......"
                    value={letterAnnoNote}
                    onChange={(e) => setLetterAnnoNote(e.target.value)}
                    rows={2}
                    autoFocus
                  />
                  <div className="coread-anno-actions">
                    <button className="roost-btn roost-btn-ghost roost-btn-sm" onClick={() => { setLetterPending(null); setLetterComposing(false); window.getSelection()?.removeAllRanges() }}>取消</button>
                    <button className="roost-btn roost-btn-sm" onClick={submitLetterAnno}>留下</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
