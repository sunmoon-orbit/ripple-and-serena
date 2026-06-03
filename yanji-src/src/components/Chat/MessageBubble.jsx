import { useMemo, useRef, useState, useCallback } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js'
import { formatTime } from '../../utils'
import { useStore } from '../../store'
import { synthesizeSpeech } from '../../api/moonMemory'

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

const AssistantIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8 C4 8 7 4 12 5 C16 6 18 9 17 13 C16 17 12 19 8 17" />
    <path d="M17 13 L21 11 L18 15" />
    <path d="M8 17 L6 21" />
    <path d="M10 17 L10 21" />
    <circle cx="13" cy="8" r="1" fill="currentColor" stroke="none" />
    <path d="M4 8 L1 7" />
  </svg>
)

const UserIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
)

export default function MessageBubble({ msg, onEdit }) {
  const isUser = msg.role === 'user'
  const isStreaming = msg.streaming
  const { avatarConfig, moonMemory } = useStore()
  const useImages = avatarConfig?.mode === 'image'
  const [editing, setEditing] = useState(false)
  const [ttsState, setTtsState] = useState('idle') // idle | loading | playing
  const audioRef = useRef(null)

  const playTts = useCallback(async () => {
    if (!moonMemory?.enabled || !moonMemory?.baseUrl || !moonMemory?.apiToken) return
    if (ttsState === 'loading') return
    if (ttsState === 'playing' && audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
      setTtsState('idle')
      return
    }
    setTtsState('loading')
    try {
      const plainText = msg.content.replace(/[#*`>_~\[\]]/g, '').slice(0, 500)
      const config = { baseUrl: moonMemory.baseUrl, apiToken: moonMemory.apiToken }
      const { audio } = await synthesizeSpeech(config, plainText)
      const audioEl = new Audio(audio)
      audioRef.current = audioEl
      audioEl.onended = () => setTtsState('idle')
      audioEl.onerror = () => setTtsState('idle')
      await audioEl.play()
      setTtsState('playing')
    } catch {
      setTtsState('idle')
    }
  }, [msg.content, moonMemory, ttsState])
  const [editText, setEditText] = useState(msg.content)
  const [thinkOpen, setThinkOpen] = useState(true)

  const html = useMemo(() => {
    if (isUser) return null
    return parseMarkdown(msg.content)
  }, [msg.content, isUser])

  return (
    <div className={`message-row ${isUser ? 'message-row-user' : 'message-row-assistant'}`}>
      {!isUser && (
        <div className="message-avatar">
          {useImages && avatarConfig.assistantImage
            ? <img src={avatarConfig.assistantImage} alt="助手" className="avatar-img" />
            : <AssistantIcon />}
        </div>
      )}
      {isUser && (
        <div className="message-avatar message-avatar-user">
          {useImages && avatarConfig.userImage
            ? <img src={avatarConfig.userImage} alt="我" className="avatar-img" />
            : <UserIcon />}
        </div>
      )}
      <div className="message-content-wrap">
        {msg.toolCalls?.length > 0 && (
          <div className="message-tool-badge">
            {msg.toolCalls.map((n, i) => <span key={i} className="tool-chip">{n}</span>)}
          </div>
        )}
        {msg.thinking && (
          <details className="thinking-block" open={thinkOpen} onToggle={(e) => setThinkOpen(e.currentTarget.open)}>
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
          {!isUser && !isStreaming && moonMemory?.enabled && (
            <button className={`msg-tts-btn${ttsState !== 'idle' ? ' active' : ''}`} onClick={playTts} title={ttsState === 'playing' ? '停止' : '朗读'}>
              {ttsState === 'loading' ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
              ) : ttsState === 'playing' ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
