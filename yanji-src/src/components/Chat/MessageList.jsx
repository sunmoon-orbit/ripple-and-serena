import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import MessageBubble from './MessageBubble'
import { useStore } from '../../store'
import { buildMessageRenderWindow, INITIAL_MESSAGE_RENDER, MESSAGE_RENDER_BATCH, renderCountForMessage } from '../../utils/messageRenderWindow.mjs'

export default function MessageList({ messages, status, onEdit, onQuote, onDelete, activeChatId, compactedThrough }) {
  const listRef = useRef(null)
  const bottomRef = useRef(null)
  // 初值用哨兵而不是 activeChatId：让「跳到底部」在首次挂载（刚打开页面）也触发，
  // 否则打开聊天窗口会停在历史消息顶部要手动拉到底（阿颖 2026-07-02 反馈）
  const prevChatId = useRef('__mount__')
  const [showBtn, setShowBtn] = useState(false)
  // 长窗口如果首次进入就把几千条 Markdown 气泡一起挂载，手机主线程会卡住。
  // 记录仍完整留在 store/IndexedDB；这里只控制当前实际画进 DOM 的尾部窗口。
  const [renderCount, setRenderCount] = useState(INITIAL_MESSAGE_RENDER)
  const prependScrollRef = useRef(null)
  const scrollAnchor = useStore((s) => s.scrollAnchor)
  const bigReady = useStore((s) => s.bigReady)
  // 官端滚动模型用：记住最后一条用户消息 id，出现新的才触发置顶（undefined=首次挂载）
  const lastUserIdRef = useRef(undefined)
  const anchorChatRef = useRef(activeChatId)
  const messageWindow = useMemo(() => buildMessageRenderWindow(messages, renderCount), [messages, renderCount])
  const { visible: visibleMessages, rendered: renderedMessages, remaining } = messageWindow

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

  const loadEarlier = useCallback(() => {
    const el = getScroller()
    if (el) prependScrollRef.current = { el, height: el.scrollHeight, top: el.scrollTop }
    setRenderCount((count) => Math.min(visibleMessages.length, count + MESSAGE_RENDER_BATCH))
  }, [visibleMessages.length])

  // 前插旧消息后保持眼前这一条不动，避免列表突然把用户推到更早的位置。
  useLayoutEffect(() => {
    const pending = prependScrollRef.current
    if (!pending) return
    pending.el.scrollTop = pending.top + (pending.el.scrollHeight - pending.height)
    prependScrollRef.current = null
  }, [remaining])

  // 日历和通话记录可能跳到首绘窗口之外。先扩大渲染窗口，调用方下一拍再定位。
  useEffect(() => {
    const reveal = (messageId) => {
      const needed = renderCountForMessage(messages, messageId, renderCount)
      if (needed <= renderCount) return false
      prependScrollRef.current = null
      setRenderCount(needed)
      return true
    }
    window.__yanjiRevealMessage = reveal
    return () => {
      if (window.__yanjiRevealMessage === reveal) delete window.__yanjiRevealMessage
    }
  }, [messages, renderCount])

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

  // 聊天记录是从 IndexedDB 异步读回来的（2026-08-02 搬家之后），读回来那一刻列表才真正
  // 长出内容——上面那个「首次挂载跳到底」当时跳的是空列表，所以读完要再跳一次。
  useEffect(() => {
    if (!bigReady) return
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom('auto')))
    const t = setTimeout(() => scrollToBottom('auto'), 260)
    return () => clearTimeout(t)
  }, [bigReady, scrollToBottom])

  // 新消息处理。两种滚动模型：
  // - 跟随模式（旧）：贴着底部就跟随滚动，否则不打扰
  // - 官端模式：发送后把自己的消息滚到视口顶端，回复在下方往下长，流式期间不跟随
  useEffect(() => {
    let lastUser = null
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if (visibleMessages[i].role === 'user') { lastUser = visibleMessages[i]; break }
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
  }, [visibleMessages, activeChatId, scrollAnchor, nearBottom, scrollToBottom])

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
        {remaining > 0 && (
          <button type="button" className="messages-load-earlier" onClick={loadEarlier}>
            再看前面的 {Math.min(MESSAGE_RENDER_BATCH, remaining)} 条
            <span>还有 {remaining} 条未展开</span>
          </button>
        )}
        {renderedMessages.map((msg, i, arr) => (
          msg.sys
            ? <div key={msg.id} className="msg-sys-line">{msg.content}</div>
            : <div key={msg.id} style={{ display: 'contents' }}>
                <MessageBubble msg={msg} onEdit={onEdit} onQuote={onQuote} onDelete={onDelete} isLast={i === arr.length - 1} />
                {msg.id === compactedThrough && <div className="msg-sys-line">上文已整理 · 完整记录仍保留</div>}
              </div>
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
