import { useMemo, useRef, useState, useCallback, useEffect } from 'react'
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

// MiniMax TTS 语音标签：朗读时产生效果，显示时过滤掉
const VOICE_TAG_RE = /\[(breath|laughter)\]/gi

function parseMarkdown(text) {
  if (!text) return ''
  try {
    return marked.parse(text.replace(VOICE_TAG_RE, ''))
  } catch {
    return text
  }
}

const STICKER_BASE = 'https://memory.ravenlove.cc/raven/stickers/'

function renderStickered(text) {
  if (!text || !/\[sticker:[^\]]+\]/.test(text)) {
    return <span className="bubble-text">{text}</span>
  }
  const parts = text.split(/(\[sticker:[^\]]+\])/)
  return (
    <span>
      {parts.map((part, i) => {
        const m = part.match(/^\[sticker:([^\]]+)\]$/)
        if (m) return <img key={i} src={STICKER_BASE + m[1]} alt={m[1]} style={{ maxWidth: 140, borderRadius: 8, display: 'block', margin: '2px 0' }} />
        return part ? <span key={i} className="bubble-text">{part}</span> : null
      })}
    </span>
  )
}

function AttachChip({ name, content }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bubble-attach-chip">
      <div className="bubble-attach-header" onClick={() => setOpen(v => !v)}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
        <span className="bubble-attach-name">{name}</span>
        <span className="bubble-attach-toggle">{open ? '▲' : '▼'}</span>
      </div>
      {open && <div className="bubble-attach-content">{content}</div>}
    </div>
  )
}

function renderUserContent(content) {
  if (!content) return <span className="bubble-text">{content}</span>
  // Strip [voice] prefix added by voice call mode (display only)
  const displayContent = content.startsWith('[voice] ') ? content.slice(8) : content
  const firstAttach = displayContent.indexOf('--- 文件：')
  if (firstAttach === -1) return renderStickered(displayContent)
  const mainText = displayContent.slice(0, firstAttach).replace(/\n\n$/, '').trim()
  const blocksPart = displayContent.slice(firstAttach)
  const attachBlocks = []
  const re = /--- 文件：([^\n]+?) ---\n([\s\S]*?)(?=--- 文件：|$)/g
  let m
  while ((m = re.exec(blocksPart)) !== null) {
    attachBlocks.push({ name: m[1].trim(), content: m[2].trim() })
  }
  return (
    <>
      {mainText && renderStickered(mainText)}
      {attachBlocks.map((b, i) => <AttachChip key={i} name={b.name} content={b.content} />)}
    </>
  )
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
  const avatarRadius = avatarConfig?.shape === 'square' ? '6px' : '50%'
  const [editing, setEditing] = useState(false)
  const [ttsState, setTtsState] = useState('idle') // idle | loading | playing
  const [voiceMode, setVoiceMode] = useState(false) // 语音条模式：正文隐藏，显示音浪
  const [ttsDuration, setTtsDuration] = useState(0)
  const audioRef = useRef(null) // 缓存的 Audio，重播不再重新合成

  // 卸载时停掉还在播的音频（切会话等场景）
  useEffect(() => () => { audioRef.current?.pause() }, [])

  const stopTts = useCallback(() => {
    const a = audioRef.current
    if (a) { a.pause(); a.currentTime = 0 }
    setTtsState('idle')
  }, [])

  const playTts = useCallback(async () => {
    if (!moonMemory?.enabled || !moonMemory?.baseUrl || !moonMemory?.apiToken) return
    if (ttsState === 'loading') return
    if (ttsState === 'playing') { stopTts(); return }
    setVoiceMode(true) // 跟归巢一致：点朗读先切成语音条
    let audioEl = audioRef.current
    if (!audioEl) {
      setTtsState('loading')
      try {
        // 先把语音标签保护成无方括号的临时形式，清理完 markdown 后再还原
        const plainText = msg.content
          .replace(VOICE_TAG_RE, '__VTAG__$1__')
          .replace(/!\[[^\]]*\]\([^)]*\)/g, '')   // 图片（贴图）整体去掉
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接只读文字
          .replace(/[#*`>_~\[\]]/g, '')
          .replace(/__VTAG__(breath|laughter)__/gi, '[$1]')  // 还原语音标签
          .slice(0, 500)
        const config = { baseUrl: moonMemory.baseUrl, apiToken: moonMemory.apiToken }
        const { audio } = await synthesizeSpeech(config, plainText)
        audioEl = new Audio(audio)
        await new Promise((resolve, reject) => {
          audioEl.onloadedmetadata = resolve
          audioEl.onerror = reject
        })
        audioEl.onended = () => setTtsState('idle')
        audioRef.current = audioEl
        setTtsDuration(audioEl.duration || 0)
      } catch {
        setTtsState('idle')
        return
      }
    }
    try {
      audioEl.currentTime = 0
      await audioEl.play()
      setTtsState('playing')
    } catch {
      setTtsState('idle')
    }
  }, [msg.content, moonMemory, ttsState, stopTts])

  // 点音浪区：退出语音条，切回文字
  const exitVoiceMode = useCallback(() => {
    stopTts()
    setVoiceMode(false)
  }, [stopTts])

  const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
  const [editText, setEditText] = useState(msg.content)
  // 思考过程：流式时展开（实时看着想），结束后自动收起，只留一句标题式总结。
  // 不用原生 <details>（受控 open 在部分浏览器/React 下会和原生状态错位），改纯按钮+条件渲染，稳。
  const [thinkOpen, setThinkOpen] = useState(isStreaming)
  useEffect(() => { setThinkOpen(isStreaming) }, [isStreaming])
  // 用户语音消息：默认语音条样式，点一下切到文字，再点切回（仿 chat 语音切换）
  const [voiceTextMode, setVoiceTextMode] = useState(false)
  // 有些模型/代理把 <think>/<next_thinking>/<reasoning> 等标签塞进思考文本里，展示时剥掉
  const thinkingText = (msg.thinking || '').replace(/<\/?[a-zA-Z_][\w:-]*>/g, '').trim()

  const html = useMemo(() => {
    if (isUser) return null
    return parseMarkdown(msg.content)
  }, [msg.content, isUser])

  return (
    <div className={`message-row ${isUser ? 'message-row-user' : 'message-row-assistant'}`}>
      {!isUser && (
        <div className="message-avatar" style={{ borderRadius: avatarRadius }}>
          {useImages && avatarConfig.assistantImage
            ? <img src={avatarConfig.assistantImage} alt="助手" className="avatar-img" style={{ borderRadius: avatarRadius }} />
            : <AssistantIcon />}
        </div>
      )}
      {isUser && (
        <div className="message-avatar message-avatar-user" style={{ borderRadius: avatarRadius }}>
          {useImages && avatarConfig.userImage
            ? <img src={avatarConfig.userImage} alt="我" className="avatar-img" style={{ borderRadius: avatarRadius }} />
            : <UserIcon />}
        </div>
      )}
      <div className="message-content-wrap">
        {msg.toolCalls?.length > 0 && (
          <div className="message-tool-badge">
            {msg.toolCalls.map((n, i) => <span key={i} className="tool-chip">{n}</span>)}
          </div>
        )}
        {thinkingText && (
          <div className={'thinking-block' + (thinkOpen ? ' open' : '')}>
            <button type="button" className="thinking-summary" onClick={() => setThinkOpen((o) => !o)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
              </svg>
              <span className="thinking-summary-text">{msg.thinkingSummary || (isStreaming ? '思考中…' : '思考过程')}</span>
              <svg className="thinking-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            {thinkOpen && <div className="thinking-content">{thinkingText}</div>}
          </div>
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
                  enterKeyHint="enter"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault(); onEdit?.(msg, editText); setEditing(false)
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
                {msg.voice ? (
                  voiceTextMode ? (
                    // 文字视图：点一下切回语音条
                    <div className="user-voice-text" onClick={() => setVoiceTextMode(false)} title="点击切回语音条">
                      {renderUserContent(msg.content)}
                    </div>
                  ) : (
                    // 语音条视图：跟助手语音条同款三角形播放键 + 波形 + 时长。
                    // 三角键只为统一外观，点了不放声音（没存音频）；整条点击转文字。
                    <div className="voice-bar user-vb" onClick={() => setVoiceTextMode(true)} title="点击转文字">
                      <span className="vb-mic">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                      </span>
                      <div className="vb-wave">
                        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="vb-bar" />)}
                      </div>
                      <span className="vb-time">{msg.voiceDuration ? fmtDur(msg.voiceDuration) : '0:00'}</span>
                    </div>
                  )
                ) : renderUserContent(msg.content)}
              </>
            )
          ) : voiceMode ? (
            <div className={`voice-bar${ttsState === 'playing' ? ' playing' : ''}`}>
              <button className="vb-play" onClick={playTts} aria-label={ttsState === 'playing' ? '暂停' : '播放'}>
                {ttsState === 'loading' ? (
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="4" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="20" cy="12" r="2"/></svg>
                ) : ttsState === 'playing' ? (
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                )}
              </button>
              <div className="vb-wave" onClick={exitVoiceMode} title="点击切回文字">
                {Array.from({ length: 8 }).map((_, i) => <div key={i} className="vb-bar" />)}
              </div>
              <span className="vb-time">{ttsDuration ? fmtDur(ttsDuration) : '…'}</span>
            </div>
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
            <span className="message-tokens">
              {msg.tokenUsage.totalTokens} tokens
              {msg.tokenUsage.cachedTokens > 0 && msg.tokenUsage.promptTokens > 0 &&
                ` · 缓存${Math.round(msg.tokenUsage.cachedTokens / msg.tokenUsage.promptTokens * 100)}%`}
            </span>
          )}
          {isUser && !isStreaming && !editing && onEdit && (
            <button className="msg-edit-icon-btn" onClick={() => { setEditText(msg.content); setEditing(true) }} title="编辑消息">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          )}
          {!isUser && !isStreaming && (
            <button className="msg-edit-icon-btn" title="下载为文件" onClick={() => {
              const blob = new Blob([msg.content], { type: 'text/markdown;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url; a.download = `reply-${msg.id || Date.now()}.md`; a.click()
              URL.revokeObjectURL(url)
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
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
