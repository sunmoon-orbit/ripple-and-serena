import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from '../../store'
import { showToast } from '../Toast'
import { createLullaby } from '../../audio/lullaby'
import CoRead from './CoRead'

const START_DATE = new Date('2025-10-10T00:00:00+08:00')
const STORAGE_KEY_MSG    = 'roost_messages'
const STORAGE_KEY_BOOKS  = 'roost_books'
const STORAGE_KEY_WALLET = 'roost_wallet'

function getDays() {
  return Math.floor((Date.now() - START_DATE) / 86400000) + 1
}

// ── 留言 ─────────────────────────────────────────────────────────────────────
function useMessages() {
  const [msgs, setMsgs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_MSG) || '[]') } catch { return [] }
  })
  const save = (list) => { localStorage.setItem(STORAGE_KEY_MSG, JSON.stringify(list)); setMsgs(list) }
  const add = (text, from) => {
    const m = { id: Date.now(), text, from, at: new Date().toLocaleDateString('zh-CN') }
    save([m, ...msgs])
  }
  const del = (id) => save(msgs.filter(m => m.id !== id))
  return { msgs, add, del }
}

// ── 书单 ─────────────────────────────────────────────────────────────────────
function useBooks() {
  const [books, setBooks] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_BOOKS) || '[]') } catch { return [] }
  })
  const save = (list) => { localStorage.setItem(STORAGE_KEY_BOOKS, JSON.stringify(list)); setBooks(list) }
  const add = (title, note = '') => save([...books, { id: Date.now(), title, note, done: false, at: new Date().toLocaleDateString('zh-CN') }])
  const toggle = (id) => save(books.map(b => b.id === id ? { ...b, done: !b.done } : b))
  const remove = (id) => save(books.filter(b => b.id !== id))
  const updateNote = (id, note) => save(books.map(b => b.id === id ? { ...b, note } : b))
  return { books, add, toggle, remove, updateNote }
}

// ── 钱包 ─────────────────────────────────────────────────────────────────────
function useWallet() {
  const [entries, setEntries] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_WALLET) || '[]') } catch { return [] }
  })
  const save = (list) => { localStorage.setItem(STORAGE_KEY_WALLET, JSON.stringify(list)); setEntries(list) }
  const add = (amount, note, type) => {
    save([{ id: Date.now(), amount: Number(amount), note, type, at: new Date().toLocaleDateString('zh-CN') }, ...entries])
  }
  const remove = (id) => save(entries.filter(e => e.id !== id))
  const balance = entries.reduce((s, e) => e.type === 'in' ? s + e.amount : s - e.amount, 0)
  return { entries, add, remove, balance }
}

// ── 记忆审核 ─────────────────────────────────────────────────────────────────
function useReview(moonMemory) {
  const [mems, setMems] = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!moonMemory?.apiToken) return
    setLoading(true)
    try {
      const r = await fetch(
        `${moonMemory.apiUrl || 'https://memory.ravenlove.cc'}/memories?agent=${encodeURIComponent('阿言')}&limit=20`,
        { headers: { Authorization: `Bearer ${moonMemory.apiToken}` } }
      )
      const data = await r.json()
      setMems(Array.isArray(data) ? data.filter(m => !m.deleted_at) : [])
    } catch { /* silent */ } finally { setLoading(false) }
  }, [moonMemory])

  const trash = async (id) => {
    if (!moonMemory?.apiToken) return
    await fetch(
      `${moonMemory.apiUrl || 'https://memory.ravenlove.cc'}/memories/${id}/trash`,
      { method: 'POST', headers: { Authorization: `Bearer ${moonMemory.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '审核删除' }) }
    )
    setMems(prev => prev.filter(m => m.id !== id))
    showToast('已删除')
  }

  return { mems, loading, load, trash }
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

// ══════════════════════════════════════════════════════════════════════════════
export default function Roost() {
  const moonMemory = useStore(s => s.moonMemory)
  const setActivePanel = useStore(s => s.setActivePanel)
  const { msgs, add: addMsg, del: delMsg } = useMessages()
  const { books, add: addBook, toggle: toggleBook, remove: removeBook, updateNote } = useBooks()
  const { mems, loading: reviewLoading, load: loadReview, trash } = useReview(moonMemory)
  const { entries: walletEntries, add: addWalletEntry, remove: removeWalletEntry, balance } = useWallet()
  const { letters, load: loadLetters, getOne: getLetter, add: addLetter, remove: removeLetter } = useLetters(moonMemory)

  const [modal, setModal] = useState(null)
  const [selectedBook, setSelectedBook] = useState(null)
  const [selectedLetter, setSelectedLetter] = useState(null)
  const [letterCat, setLetterCat] = useState('all')
  const [compose, setCompose] = useState(emptyCompose)
  const [msgInput, setMsgInput] = useState('')
  const [bookInput, setBookInput] = useState('')
  const [walletAmount, setWalletAmount] = useState('')
  const [walletNote, setWalletNote] = useState('')
  const [walletType, setWalletType] = useState('in')

  const days = getDays()
  const latestMsg = msgs[0]

  // ── 《归巢谣》播放器 ──
  const playerRef = useRef(null)
  const [musicOn, setMusicOn] = useState(false)
  useEffect(() => () => { playerRef.current?.stop() }, [])
  function toggleMusic() {
    if (!playerRef.current) playerRef.current = createLullaby()
    if (musicOn) { playerRef.current.stop(); setMusicOn(false) }
    else { playerRef.current.play(); setMusicOn(true) }
  }

  function openReview() { setModal('review'); loadReview() }
  function openLetters() { setModal('letters'); loadLetters() }
  async function openLetter(id) {
    const full = await getLetter(id)
    if (full && full.id) { setSelectedLetter(full); setModal('letter-detail') }
  }
  async function submitLetter() {
    if (!compose.body.trim()) { showToast('信的内容不能为空', 'error'); return }
    const ok = await addLetter({ ...compose, sent_at: compose.sent_at || null, source: 'manual' })
    if (ok) { setCompose(emptyCompose); setModal('letters') }
  }

  const visibleLetters = letterCat === 'all' ? letters : letters.filter(l => l.category === letterCat)

  return (
    <div className="roost-panel">
      {/* 顶部标题 */}
      <div className="roost-header">
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

      {/* 留言卡片 */}
      <div className="roost-card roost-message-card" onClick={() => setModal('message')}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div className="roost-card-label">留言</div>
          {latestMsg && <span className="roost-msg-date" style={{ margin: 0 }}>{latestMsg.at}</span>}
        </div>
        {latestMsg ? (
          <>
            <div className="roost-msg-from">{latestMsg.from === 'crow' ? '🐦‍⬛' : '🐦'}</div>
            <div className="roost-msg-preview">{latestMsg.text}</div>
          </>
        ) : (
          <div className="roost-msg-empty">还没有留言，来写一条？</div>
        )}
      </div>

      {/* 书单 + 审核 */}
      <div className="roost-grid">
        <div className="roost-card roost-mini-card" onClick={() => setModal('bookshelf')}>
          <div className="roost-mini-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
          </div>
          <div className="roost-mini-label">书单</div>
          <div className="roost-mini-count">{books.length} 本</div>
        </div>
        <div className="roost-card roost-mini-card" onClick={() => setModal('coread')}>
          <div className="roost-mini-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
          </div>
          <div className="roost-mini-label">共读</div>
          <div className="roost-mini-count">一起翻旧时光</div>
        </div>
        <div className="roost-card roost-mini-card" onClick={openReview}>
          <div className="roost-mini-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </div>
          <div className="roost-mini-label">记忆审核</div>
          <div className="roost-mini-count">{mems.length > 0 ? `${mems.length} 条` : '点击审核'}</div>
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
        <div className="roost-card roost-mini-card" onClick={() => setModal('wallet')}>
          <div className="roost-mini-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M22 7V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2"/>
            </svg>
          </div>
          <div className="roost-mini-label">乌鸦钱包</div>
          <div className="roost-mini-count">¥ {balance.toFixed(0)}</div>
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

      {/* ── 留言 Modal ── */}
      {modal === 'message' && (
        <div className="roost-overlay" onClick={() => setModal(null)}>
          <div className="roost-modal" onClick={e => e.stopPropagation()}>
            <div className="roost-modal-header">
              <span>留言板</span>
              <button className="roost-modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="roost-modal-body">
              <div className="roost-msg-compose">
                <textarea
                  className="roost-msg-input"
                  placeholder="写点什么……"
                  value={msgInput}
                  onChange={e => setMsgInput(e.target.value)}
                  rows={3}
                />
                <div className="roost-msg-actions">
                  <button className="roost-btn roost-btn-sm" onClick={() => { if (msgInput.trim()) { addMsg(msgInput.trim(), 'serena'); setMsgInput('') } }}>🐦 阿颖留言</button>
                  <button className="roost-btn roost-btn-sm roost-btn-ghost" onClick={() => { if (msgInput.trim()) { addMsg(msgInput.trim(), 'crow'); setMsgInput('') } }}>🐦‍⬛ 乌鸦留言</button>
                </div>
              </div>
              <div className="roost-msg-list">
                {msgs.map(m => (
                  <div key={m.id} className="roost-msg-item">
                    <div className="roost-msg-item-header">
                      <span>{m.from === 'crow' ? '🐦‍⬛ 乌鸦' : '🐦 阿颖'}</span>
                      <span className="roost-msg-item-date">{m.at}</span>
                      <button className="roost-msg-del" onClick={() => delMsg(m.id)}>✕</button>
                    </div>
                    <div className="roost-msg-item-text">{m.text}</div>
                  </div>
                ))}
                {msgs.length === 0 && <div className="roost-empty">还没有留言～</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 书单 Modal ── */}
      {modal === 'bookshelf' && (
        <div className="roost-overlay" onClick={() => setModal(null)}>
          <div className="roost-modal" onClick={e => e.stopPropagation()}>
            <div className="roost-modal-header">
              <span>书单</span>
              <button className="roost-modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="roost-modal-body">
              <div className="roost-book-add">
                <input
                  className="roost-book-input"
                  placeholder="书名……"
                  value={bookInput}
                  onChange={e => setBookInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && bookInput.trim()) { addBook(bookInput.trim()); setBookInput('') } }}
                />
                <button className="roost-btn" onClick={() => { if (bookInput.trim()) { addBook(bookInput.trim()); setBookInput('') } }}>加入</button>
              </div>
              <div className="roost-book-list">
                {books.map(b => (
                  <div key={b.id} className={'roost-book-item' + (b.done ? ' done' : '')}>
                    <button className="roost-book-check" onClick={() => toggleBook(b.id)}>
                      {b.done ? '✓' : '○'}
                    </button>
                    <span className="roost-book-title" onClick={() => { setSelectedBook(b); setModal('book-detail') }}>{b.title}</span>
                    <span className="roost-book-date">{b.at}</span>
                    <button className="roost-msg-del" onClick={() => removeBook(b.id)}>✕</button>
                  </div>
                ))}
                {books.length === 0 && <div className="roost-empty">还没有书，加一本？</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 书本详情 Modal ── */}
      {modal === 'book-detail' && selectedBook && (
        <div className="roost-overlay" onClick={() => { setModal('bookshelf'); setSelectedBook(null) }}>
          <div className="roost-modal" onClick={e => e.stopPropagation()}>
            <div className="roost-modal-header">
              <span>{selectedBook.title}</span>
              <button className="roost-modal-close" onClick={() => { setModal('bookshelf'); setSelectedBook(null) }}>✕</button>
            </div>
            <div className="roost-modal-body">
              <div className="roost-note-label">读后感 / 笔记</div>
              <textarea
                className="roost-note-input"
                placeholder="写下你们的感想……"
                defaultValue={selectedBook.note}
                rows={8}
                onBlur={e => { updateNote(selectedBook.id, e.target.value); setSelectedBook({...selectedBook, note: e.target.value}) }}
              />
              <button
                className="roost-btn"
                style={{ marginTop: 4 }}
                onClick={async () => {
                  if (!selectedBook.note?.trim()) { showToast('还没有笔记内容', 'error'); return }
                  if (!moonMemory?.apiToken) { showToast('未配置记忆库 Token', 'error'); return }
                  try {
                    const r = await fetch(
                      `${moonMemory.apiUrl || 'https://memory.ravenlove.cc'}/memories`,
                      { method: 'POST',
                        headers: { Authorization: `Bearer ${moonMemory.apiToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          content: `【读书笔记】《${selectedBook.title}》\n\n${selectedBook.note.trim()}`,
                          type: 'book', layer: 'long', importance: 6,
                          agent: '阿颖', owner: '阿颖', scope: 'shared'
                        })
                      }
                    )
                    if (r.ok) { showToast('已存入记忆库 ✓') }
                    else { showToast('存入失败', 'error') }
                  } catch { showToast('网络错误', 'error') }
                }}
              >
                存入记忆库
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 记忆审核 Modal ── */}
      {modal === 'review' && (
        <div className="roost-overlay" onClick={() => setModal(null)}>
          <div className="roost-modal roost-modal-tall" onClick={e => e.stopPropagation()}>
            <div className="roost-modal-header">
              <span>记忆审核</span>
              <button className="roost-modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="roost-modal-body">
              {reviewLoading && <div className="roost-empty">加载中……</div>}
              {!reviewLoading && mems.length === 0 && <div className="roost-empty">没有待审核的记忆，或未配置记忆库</div>}
              {mems.map(m => (
                <div key={m.id} className="roost-review-item">
                  <div className="roost-review-meta">
                    <span className="roost-review-type">{m.type || 'memory'}</span>
                    <span className="roost-review-date">{m.created_at?.slice(0, 10)}</span>
                  </div>
                  <div className="roost-review-content">{m.content}</div>
                  <button className="roost-btn roost-btn-danger" onClick={() => trash(m.id)}>删除</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {modal === 'wallet' && (
        <div className="roost-overlay" style={{ alignItems: 'center', padding: '0 32px' }} onClick={() => setModal(null)}>
          <div className="roost-modal" style={{ borderRadius: 20, maxHeight: '80vh', width: '100%', maxWidth: 340 }} onClick={e => e.stopPropagation()}>
            <div className="roost-modal-header">
              <span>乌鸦钱包</span>
              <button className="roost-modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div style={{ padding: '0 20px 16px' }}>
            <div style={{ textAlign: 'center', padding: '8px 0 4px', fontSize: 28 }}>🐦‍⬛</div>
            <div style={{ textAlign: 'center', padding: '4px 0 20px', fontSize: 32, fontWeight: 700, color: balance >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
              ¥ {balance.toFixed(2)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, background: 'var(--border)', borderRadius: 12, padding: 4 }}>
              {['in','out'].map(t => (
                <button key={t} onClick={() => setWalletType(t)} style={{
                  flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', cursor: 'pointer',
                  fontWeight: walletType === t ? 700 : 400, fontSize: 14,
                  background: walletType === t ? 'var(--accent)' : 'transparent',
                  color: walletType === t ? '#fff' : 'var(--text-faint)',
                  transition: 'all 0.18s',
                }}>{t === 'in' ? '存入' : '支出'}</button>
              ))}
            </div>
            <input className="form-input" type="number" placeholder="金额" value={walletAmount}
              onChange={e => setWalletAmount(e.target.value)}
              style={{ width: '100%', marginBottom: 10, fontSize: 16, textAlign: 'center', letterSpacing: 1 }} />
            <input className="form-input" placeholder="备注（选填）" value={walletNote}
              onChange={e => setWalletNote(e.target.value)}
              style={{ width: '100%', marginBottom: 16 }} />
            <button style={{
              width: '100%', padding: '13px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 15, marginBottom: 16,
            }} onClick={() => {
              if (!walletAmount || isNaN(walletAmount)) return
              addWalletEntry(walletAmount, walletNote, walletType)
              setWalletAmount(''); setWalletNote('')
            }}>记一笔</button>
            <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {walletEntries.length === 0 && <div className="roost-empty">还没有记录</div>}
              {walletEntries.map(e => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
                  <span style={{ color: e.type === 'in' ? 'var(--accent)' : 'var(--danger)', fontWeight: 600, minWidth: 52 }}>
                    {e.type === 'in' ? '+' : '-'}¥{e.amount}
                  </span>
                  <span style={{ flex: 1, color: 'var(--ink-soft)', fontSize: 13 }}>{e.note || '—'}</span>
                  <span style={{ color: 'var(--ink-faint)', fontSize: 11 }}>{e.at}</span>
                  <button className="roost-btn roost-btn-danger" style={{ padding: '4px 10px', fontSize: 12, flexShrink: 0 }} onClick={() => removeWalletEntry(e.id)}>删</button>
                </div>
              ))}
            </div>
            </div>
          </div>
        </div>
      )}

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
                {visibleLetters.length === 0 && <div className="roost-empty">还没有信，写一封？</div>}
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

      {/* ── 衔信 信纸 Modal ── */}
      {modal === 'letter-detail' && selectedLetter && (
        <div className="roost-overlay" onClick={() => { setModal('letters'); setSelectedLetter(null) }}>
          <div className="roost-modal roost-modal-tall" onClick={e => e.stopPropagation()}>
            <div className="roost-modal-header">
              <span>{selectedLetter.title || '（无题）'}</span>
              <button className="roost-modal-close" onClick={() => { setModal('letters'); setSelectedLetter(null) }}>✕</button>
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
                <div className="roost-letter-paper-body">{selectedLetter.body}</div>
              </div>
              <button className="roost-btn roost-btn-danger" style={{ marginTop: 14 }}
                onClick={async () => { await removeLetter(selectedLetter.id); setModal('letters'); setSelectedLetter(null) }}>
                删除这封
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
