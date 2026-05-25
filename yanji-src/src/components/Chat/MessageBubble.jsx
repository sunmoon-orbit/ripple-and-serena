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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a5 5 0 0 1 5 5c0 1.7-.85 3.2-2.14 4.1A6 6 0 0 1 18 17v1H6v-1a6 6 0 0 1 3.14-5.9A5 5 0 0 1 7 7a5 5 0 0 1 5-5z" />
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
