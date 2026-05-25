import { useMemo, useRef } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js'
import { formatTime } from '../../utils'

marked.setOptions({
  breaks: true,
  gfm: true,
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value
    }
    return hljs.highlightAuto(code).value
  },
})

function parseMarkdown(text) {
  if (!text) return ''
  try {
    return marked.parse(text)
  } catch {
    return text
  }
}

export default function MessageBubble({ msg }) {
  const isUser = msg.role === 'user'
  const isStreaming = msg.streaming

  const html = useMemo(() => {
    if (isUser) return null
    return parseMarkdown(msg.content)
  }, [msg.content, isUser])

  return (
    <div className={`message-row ${isUser ? 'message-row-user' : 'message-row-assistant'}`}>
      {!isUser && (
        <div className="message-avatar">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8 C4 8 7 4 12 5 C16 6 18 9 17 13 C16 17 12 19 8 17" />
            <path d="M17 13 L21 11 L18 15" />
            <path d="M8 17 L6 21" />
            <path d="M10 17 L10 21" />
            <circle cx="13" cy="8" r="1" fill="currentColor" stroke="none" />
            <path d="M4 8 L1 7" />
          </svg>
        </div>
      )}
      <div className="message-content-wrap">
        {msg.toolCalls?.length > 0 && (
          <div className="message-tool-badge">
            {msg.toolCalls.map((n, i) => <span key={i} className="tool-chip">{n}</span>)}
          </div>
        )}
        {msg.thinking && (
          <details className="thinking-block" open={isStreaming}>
            <summary>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
              </svg>
              思考过程{isStreaming ? '…' : ''}
            </summary>
            <div className="thinking-content">{msg.thinking}</div>
          </details>
        )}
        <div className={`message-bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}${isStreaming ? ' streaming' : ''}`}>
          {isUser ? (
            <>
              {msg.images?.length > 0 && (
                <div className="bubble-images">
                  {msg.images.map((src, i) => <img key={i} src={src} alt="" className="bubble-img" />)}
                </div>
              )}
              <span className="bubble-text">{msg.content}</span>
            </>
          ) : (
            <div
              className="bubble-markdown"
              dangerouslySetInnerHTML={{ __html: html || (isStreaming ? '<span class="cursor-blink">▌</span>' : '') }}
            />
          )}
        </div>
        <div className="message-meta">
          <span className="message-time">{formatTime(msg.createdAt)}</span>
          {msg.tokenUsage && (
            <span className="message-tokens">{msg.tokenUsage.totalTokens} tokens</span>
          )}
        </div>
      </div>
    </div>
  )
}
