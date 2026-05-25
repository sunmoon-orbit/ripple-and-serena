import { useMemo, useRef, useState } from 'react'
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

export default function MessageBubble({ msg, onEdit }) {
  const isUser = msg.role === 'user'
  const isStreaming = msg.streaming
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(msg.content)

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
            editing ? (
              <div className="msg-edit-wrap">
                <textarea
                  className="msg-edit-textarea"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditing(false)
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      onEdit?.(msg, editText); setEditing(false)
                    }
                  }}
                />
                <div className="msg-edit-actions">
                  <button className="msg-edit-btn" onClick={() => setEditing(false)}>取消</button>
                  <button className="msg-edit-btn primary" onClick={() => { onEdit?.(msg, editText); setEditing(false) }}>保存并重发</button>
                </div>
              </div>
            ) : (
              <>
                {msg.images?.length > 0 && (
                  <div className="bubble-images">
                    {msg.images.map((src, i) => <img key={i} src={src} alt="" className="bubble-img" />)}
                  </div>
                )}
                <span className="bubble-text">{msg.content}</span>
              </>
            )
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
          {isUser && !isStreaming && !editing && onEdit && (
            <button className="msg-edit-icon-btn" onClick={() => { setEditText(msg.content); setEditing(true) }} title="编辑消息">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
