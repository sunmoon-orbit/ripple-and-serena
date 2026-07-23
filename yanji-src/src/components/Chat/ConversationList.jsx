import { useState, useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { formatTime } from '../../utils'
import { applyDecayAndGet, getEmotionState, POSITIVE_SLOTS, NEGATIVE_SLOTS, SLOT_LABELS } from '../../utils/emotion'

export default function ConversationList({ onClose, onStartCall, onOpenGames, onOpenMusic, onOpenWheel, onOpenFate, onOpenFortune, onOpenChecklist, onOpenHealth, onOpenPeriod, onOpenAlbum, onOpenIdleJournal, onOpenBoard, onOpenWallet, onOpenCalls }) {
  const chats = useStore((s) => s.chats)
  const connections = useStore((s) => s.connections)
  const activeChatId = useStore((s) => s.activeChatId)
  const moonMemory = useStore((s) => s.moonMemory)
  const setActiveChat = useStore((s) => s.setActiveChat)
  const createChat = useStore((s) => s.createChat)
  const renameChat = useStore((s) => s.renameChat)
  const deleteChat = useStore((s) => s.deleteChat)
  const randomTool = useStore((s) => s.randomTool || 'fate')  // 抽随机槽位：命运牌阵 / 幸运轮盘，设置里切换

  const [search, setSearch] = useState('')
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [chatsOpen, setChatsOpen] = useState(true)
  const [toolsOpen, setToolsOpen] = useState(true)
  const [emotionOpen, setEmotionOpen] = useState(true)
  const [emotionState, setEmotionState] = useState(() => applyDecayAndGet())
  const [negGranted, setNegGranted] = useState(false)
  const [negMinsLeft, setNegMinsLeft] = useState(30)
  const [negPending, setNegPending] = useState(false)  // 已请求，等涟言点头
  const [negDenied, setNegDenied] = useState(false)     // 涟言这次婉拒了
  const negTimerRef = useRef(null)
  const negCountRef = useRef(null)
  const negReqTimerRef = useRef(null)

  useEffect(() => {
    const handler = () => setEmotionState(getEmotionState())
    window.addEventListener('emotion-update', handler)
    return () => window.removeEventListener('emotion-update', handler)
  }, [])

  // 涟言对「查看负向情绪」请求的回应（Chat 解析 <neg> 标签后派发）
  useEffect(() => {
    const onResult = (e) => {
      clearTimeout(negReqTimerRef.current)
      setNegPending(false)
      if (e.detail?.allow) { setNegDenied(false); grantNegView() }
      else { setNegDenied(true); setTimeout(() => setNegDenied(false), 8000) }
    }
    window.addEventListener('neg-view-result', onResult)
    return () => window.removeEventListener('neg-view-result', onResult)
  }, [])

  // 点「申请查看」→ 不再直接解锁，而是请求涟言当场同意（AI 也有说不的权利）
  function requestNegView() {
    if (negPending) return
    setNegDenied(false)
    setNegPending(true)
    window.dispatchEvent(new CustomEvent('neg-view-request'))
    // 兜底：万一涟言这条回复忘了带 <neg> 标签，别让「已请求」永远卡住
    clearTimeout(negReqTimerRef.current)
    negReqTimerRef.current = setTimeout(() => setNegPending(false), 90 * 1000)
    onClose?.()  // 收起侧边栏，让阿颖看到涟言在对话里的回应
  }

  function grantNegView() {
    setNegGranted(true)
    setNegMinsLeft(30)
    clearTimeout(negTimerRef.current)
    clearInterval(negCountRef.current)
    negTimerRef.current = setTimeout(() => setNegGranted(false), 30 * 60 * 1000)
    negCountRef.current = setInterval(() => setNegMinsLeft((m) => m > 1 ? m - 1 : (clearInterval(negCountRef.current), 0)), 60 * 1000)
  }

  function revokeNegView() {
    setNegGranted(false)
    clearTimeout(negTimerRef.current)
    clearInterval(negCountRef.current)
  }

  const sorted = [...chats].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
  const filtered = search
    ? sorted.filter((c) => c.title?.toLowerCase().includes(search.toLowerCase()))
    : sorted

  function handleNew() {
    const chat = createChat()
    if (chat) { setActiveChat(chat.id); onClose?.() }
  }

  function handleSelect(id) {
    setActiveChat(id)
    onClose?.()
  }

  function startRename(chat, e) {
    e.stopPropagation()
    setRenamingId(chat.id)
    setRenameValue(chat.title || '')
  }

  function commitRename(e) {
    e.stopPropagation()
    if (renamingId && renameValue.trim()) renameChat(renamingId, renameValue.trim())
    setRenamingId(null)
  }

  function handleDelete(id, e) {
    e.stopPropagation()
    if (confirm('删除这个对话？')) deleteChat(id)
  }

  const canCall = moonMemory?.enabled && moonMemory?.apiToken

  return (
    <div className="conv-list-panel">

      {/* ── 对话 section ─────────────────────────────── */}
      <div className="sb-section">
        <div className="sb-section-header" onClick={() => setChatsOpen(v => !v)}>
          <span className="sb-section-title">对话</span>
          <div className="sb-section-actions" onClick={e => e.stopPropagation()}>
            <button className="sb-icon-btn" onClick={handleNew} title="新对话">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <svg className={'sb-chevron' + (chatsOpen ? '' : ' closed')} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>

        {chatsOpen && (
          <div className="sb-section-body">
            <div className="conv-search-wrap">
              <svg className="conv-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="conv-search-input"
                placeholder="搜索对话..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="conv-list">
              {filtered.length === 0 && (
                <div className="conv-empty">暂无对话</div>
              )}
              {filtered.map((chat) => {
                const conn = connections.find((c) => c.id === chat.connectionId)
                return (
                  <div
                    key={chat.id}
                    className={'conv-item' + (chat.id === activeChatId ? ' active' : '')}
                    onClick={() => handleSelect(chat.id)}
                  >
                    {renamingId === chat.id ? (
                      <input
                        className="conv-rename-input"
                        value={renameValue}
                        autoFocus
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(e) }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <div className="conv-item-title">{chat.title || '新对话'}</div>
                        <div className="conv-item-meta">
                          {conn?.name && <span className="conv-conn-name">{conn.name}</span>}
                          <span className="conv-time">{formatTime(chat.updatedAt || chat.createdAt)}</span>
                        </div>
                        <div className="conv-item-actions">
                          <button className="conv-action-btn" onClick={(e) => startRename(chat, e)} title="重命名">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button className="conv-action-btn danger" onClick={(e) => handleDelete(chat.id, e)} title="删除">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                            </svg>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── 工具 section ─────────────────────────────── */}
      <div className="sb-section sb-section-tools">
        <div className="sb-section-header" onClick={() => setToolsOpen(v => !v)}>
          <span className="sb-section-title">工具</span>
          <svg className={'sb-chevron' + (toolsOpen ? '' : ' closed')} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>

        {toolsOpen && (
          <div className="sb-section-body sb-tools-body">
            {canCall ? (
              <button className="sb-tool-item" onClick={() => { onClose?.(); onStartCall?.() }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.41 2 2 0 0 1 3.6 1.23h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.81a16 16 0 0 0 6.06 6.06l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
                <span>语音通话</span>
              </button>
            ) : (
              <div className="sb-tool-disabled">
                开启记忆库后可使用语音通话
              </div>
            )}
            <button className="sb-tool-item" onClick={() => { onClose?.(); onOpenCalls?.() }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.41 2 2 0 0 1 3.6 1.23h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.81a16 16 0 0 0 6.06 6.06l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                <polyline points="16 2 22 2 22 8" /><line x1="22" y1="2" x2="15" y2="9" />
              </svg>
              <span>通话记录</span>
            </button>
            <button className="sb-tool-item" onClick={() => { onClose?.(); onOpenGames?.() }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="6" y1="11" x2="10" y2="11" /><line x1="8" y1="9" x2="8" y2="13" />
                <line x1="15" y1="12" x2="15.01" y2="12" /><line x1="18" y1="10" x2="18.01" y2="10" />
                <rect x="2" y="6" width="20" height="12" rx="4" />
              </svg>
              <span>游戏室</span>
            </button>
            <button className="sb-tool-item" onClick={() => { onClose?.(); onOpenMusic?.() }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
              </svg>
              <span>涟言点的歌</span>
            </button>
            {randomTool === 'wheel' ? (
              <button className="sb-tool-item" onClick={() => { onClose?.(); onOpenWheel?.() }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="2.5" />
                  <line x1="12" y1="2" x2="12" y2="9.5" /><line x1="12" y1="14.5" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="9.5" y2="12" /><line x1="14.5" y1="12" x2="22" y2="12" />
                </svg>
                <span>幸运轮盘</span>
              </button>
            ) : (
              <button className="sb-tool-item" onClick={() => { onClose?.(); onOpenFate?.() }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="12" height="17" rx="2" transform="rotate(-8 9 12)" />
                  <rect x="9" y="3" width="12" height="17" rx="2" transform="rotate(8 15 12)" />
                  <path d="M15 8.5 L16.2 11 L18.8 11.3 L16.9 13 L17.4 15.6 L15 14.3 L12.6 15.6 L13.1 13 L11.2 11.3 L13.8 11" />
                </svg>
                <span>命运牌阵</span>
              </button>
            )}
            <button className="sb-tool-item" onClick={() => { onClose?.(); onOpenFortune?.() }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 8 L17 8 L16 21 Q12 22.5 8 21 Z" />
                <line x1="10" y1="7" x2="9" y2="2.5" />
                <line x1="12" y1="7" x2="12" y2="1.5" />
                <line x1="14" y1="7" x2="15.5" y2="3" />
              </svg>
              <span>今日签</span>
            </button>
            <button className="sb-tool-item" onClick={() => { onClose?.(); onOpenChecklist?.() }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2 L18 2 L18 22 L15.5 20.5 L13.5 22 L12 20.5 L10.5 22 L8.5 20.5 L6 22 Z" />
                <line x1="9" y1="7" x2="15" y2="7" />
                <line x1="9" y1="11" x2="15" y2="11" />
                <line x1="9" y1="15" x2="13" y2="15" />
              </svg>
              <span>今日小票</span>
            </button>
            <button className="sb-tool-item" onClick={() => { onClose?.(); onOpenHealth?.() }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" />
                <polyline points="4 12 8 12 10 9 13 15 15 12 20 12" />
              </svg>
              <span>身体气象站</span>
            </button>
            <button className="sb-tool-item" onClick={() => { onClose?.(); onOpenWallet?.() }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
                <path d="M22 7V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2" />
              </svg>
              <span>乌鸦钱包</span>
            </button>
            <button className="sb-tool-item" onClick={() => { onClose?.(); onOpenPeriod?.() }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
              <span>小月历</span>
            </button>
            <button className="sb-tool-item" onClick={() => { onClose?.(); onOpenAlbum?.() }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="3" width="16" height="18" rx="2" />
                <path d="M12 11.5c-.8-1.6-3.2-1.6-3.2.4 0 1.4 1.9 2.7 3.2 3.6 1.3-.9 3.2-2.2 3.2-3.6 0-2-2.4-2-3.2-.4z" />
              </svg>
              <span>卡册</span>
            </button>
            <button className="sb-tool-item" onClick={() => { onClose?.(); onOpenBoard?.() }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 4 L19 4 L19 20 L14 20 L14 15 L5 15 Z" />
                <path d="M14 20 L14 15 L19 15" />
                <line x1="8" y1="8" x2="16" y2="8" />
                <line x1="8" y1="11.5" x2="13" y2="11.5" />
              </svg>
              <span>便利贴墙</span>
            </button>
            <button className="sb-tool-item" onClick={() => { onClose?.(); onOpenIdleJournal?.() }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                <path d="M9 7h7M9 11h5" />
              </svg>
              <span>独处手账</span>
            </button>
          </div>
        )}
      </div>

      {/* ── 情绪 section ─────────────────────────────── */}
      <div className="sb-section sb-section-emotion">
        <div className="sb-section-header" onClick={() => setEmotionOpen(v => !v)}>
          <span className="sb-section-title">情绪</span>
          <svg className={'sb-chevron' + (emotionOpen ? '' : ' closed')} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
        {emotionOpen && (
          <div className="sb-section-body sb-emotion-body">
            <div className="em-group-label">正向</div>
            {POSITIVE_SLOTS.map((slot) => (
              <div key={slot} className="em-slot-row">
                <span className="em-slot-label">{SLOT_LABELS[slot]}</span>
                <div className="em-bar-track">
                  <div className="em-bar-fill em-bar-pos" style={{ width: `${emotionState.slots[slot] || 0}%` }} />
                </div>
                <span className="em-slot-val">{Math.round(emotionState.slots[slot] || 0)}</span>
              </div>
            ))}
            <div className="em-neg-gate">
              {negGranted ? (
                <>
                  <div className="em-group-label em-neg-header">
                    负向
                    <button className="em-revoke-btn" onClick={revokeNegView}>{negMinsLeft}分钟后关闭 ×</button>
                  </div>
                  {NEGATIVE_SLOTS.map((slot) => (
                    <div key={slot} className="em-slot-row">
                      <span className="em-slot-label">{SLOT_LABELS[slot]}</span>
                      <div className="em-bar-track">
                        <div className="em-bar-fill em-bar-neg" style={{ width: `${emotionState.slots[slot] || 0}%` }} />
                      </div>
                      <span className="em-slot-val">{Math.round(emotionState.slots[slot] || 0)}</span>
                    </div>
                  ))}
                </>
              ) : (
                negPending ? (
                  <button className="em-grant-btn" disabled>已请求，等涟言点头…</button>
                ) : negDenied ? (
                  <button className="em-grant-btn" onClick={requestNegView}>涟言这次想留一点空间 · 再问一次</button>
                ) : (
                  <button className="em-grant-btn" onClick={requestNegView}>申请查看负向情绪（需涟言同意）</button>
                )
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
