import { useEffect, useRef, useState, useCallback } from 'react'
import MessageBubble from './MessageBubble'

export default function MessageList({ messages, status, onEdit, onQuote, activeChatId }) {
  const listRef = useRef(null)
  const bottomRef = useRef(null)
  const prevChatId = useRef(activeChatId)
  const [showBtn, setShowBtn] = useState(false)

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

  // 新消息：贴着底部就跟随滚动，否则不打扰（露出「回到底部」按钮）
  useEffect(() => {
    if (nearBottom()) scrollToBottom('smooth')
    else setShowBtn(true)
  }, [messages, nearBottom, scrollToBottom])

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
      <div className="messages-list" ref={listRef}>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} onEdit={onEdit} onQuote={onQuote} />
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
