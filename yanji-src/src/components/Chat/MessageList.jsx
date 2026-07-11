import { useEffect, useRef, useState, useCallback } from 'react'
import MessageBubble from './MessageBubble'
import { useStore } from '../../store'

export default function MessageList({ messages, status, onEdit, onQuote, onDelete, activeChatId }) {
  const listRef = useRef(null)
  const bottomRef = useRef(null)
  // 初值用哨兵而不是 activeChatId：让「跳到底部」在首次挂载（刚打开页面）也触发，
  // 否则打开聊天窗口会停在历史消息顶部要手动拉到底（阿颖 2026-07-02 反馈）
  const prevChatId = useRef('__mount__')
  const [showBtn, setShowBtn] = useState(false)
  const scrollAnchor = useStore((s) => s.scrollAnchor)
  // 官端滚动模型用：记住最后一条用户消息 id，出现新的才触发置顶（undefined=首次挂载）
  const lastUserIdRef = useRef(undefined)
  const anchorChatRef = useRef(activeChatId)

  const getScroller = () => listRef.current?.parentElement || null

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    const el = getScroller()
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  const nearBottom = useCallback(() => {
    const el = getScroller()
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 140
  }, [])

  // 切换会话：等布局/图片稳定后瞬跳到底部（不用 smooth，避免停在半路旧消息——这就是那个bug）
  useEffect(() => {
    if (prevChatId.current !== activeChatId) {
      prevChatId.current = activeChatId
      setShowBtn(false)
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom('auto')))
      const t = setTimeout(() => scrollToBottom('auto'), 260) // 图片/markdown 后续撑高再兜一次
      return () => clearTimeout(t)
    }
  }, [activeChatId, scrollToBottom])

  // 新消息处理。两种滚动模型：
  // - 跟随模式（旧）：贴着底部就跟随滚动，否则不打扰
  // - 官端模式：发送后把自己的消息滚到视口顶端，回复在下方往下长，流式期间不跟随
  useEffect(() => {
    let lastUser = null
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUser = messages[i]; break }
    }
    // 首次挂载 / 切换会话：只记录，不触发置顶
    if (lastUserIdRef.current === undefined || anchorChatRef.current !== activeChatId) {
      anchorChatRef.current = activeChatId
      lastUserIdRef.current = lastUser?.id ?? null
      return
    }
    const isNewUserMsg = lastUser && lastUser.id !== lastUserIdRef.current
    if (lastUser) lastUserIdRef.current = lastUser.id

    if (scrollAnchor) {
      if (isNewUserMsg) {
        // 双 rAF 等新消息+占位回复完成布局，再把用户消息顶到视口顶端
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const el = getScroller()
          const rows = listRef.current?.querySelectorAll('.message-row-user')
          const row = rows?.[rows.length - 1]
          if (el && row) el.scrollTo({ top: row.offsetTop - 8, behavior: 'smooth' })
        }))
      } else if (!nearBottom()) {
        setShowBtn(true)
      }
      return
    }
    if (nearBottom()) scrollToBottom('smooth')
    else setShowBtn(true)
  }, [messages, activeChatId, scrollAnchor, nearBottom, scrollToBottom])

  // 滚动监听：离底部远就显示「回到底部」
  useEffect(() => {
    const el = getScroller()
    if (!el) return
    const onScroll = () => setShowBtn(!nearBottom())
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [activeChatId, messages.length, nearBottom])

  if (!messages.length && !status) {
    return (
      <div className="messages-empty">
        <div className="messages-empty-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <p className="messages-empty-hint">开始新的对话</p>
      </div>
    )
  }

  return (
    <>
      <div className={'messages-list' + (scrollAnchor ? ' anchor-mode' : '')} ref={listRef}>
        {messages.filter((m) => !m.hidden).map((msg, i, arr) => (
          msg.sys
            ? <div key={msg.id} className="msg-sys-line">{msg.content}</div>
            : <MessageBubble key={msg.id} msg={msg} onEdit={onEdit} onQuote={onQuote} onDelete={onDelete} isLast={i === arr.length - 1} />
        ))}
        {status && (
          <div className="message-status">{status}</div>
        )}
        <div ref={bottomRef} />
      </div>
      {showBtn && (
        <button className="scroll-bottom-btn" onClick={() => scrollToBottom('smooth')} title="回到最新">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
          </svg>
        </button>
      )}
    </>
  )
}
