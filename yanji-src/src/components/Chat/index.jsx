import { useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { sendMessage, normalizeProvider, BUILTIN_MODELS, buildSystemPrompt } from '../../api/llm'
import { uuid } from '../../utils'
import { showToast } from '../Toast'
import ConversationList from './ConversationList'
import MessageList from './MessageList'
import ChatInput from './ChatInput'

export default function Chat() {
  const store = useStore()
  const {
    chats, activeChatId, connections, activeConnectionId,
    globalInstruction, memoryItems, generationConfig,
    searchConfig, moonMemory, autoTools,
    createChat, setActiveChat, getActiveConnection, getActiveChat, getMessages,
    addMessage, updateMessage, removeLastEmptyAssistant, truncateMessagesFrom, touchChat,
    recordTokenUsage, updateChatModel, updateChatConnection, applyContextLimit,
  } = store

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [modelPanelOpen, setModelPanelOpen] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [status, setStatus] = useState('')
  const [pendingImages, setPendingImages] = useState([])
  const [bgMenuOpen, setBgMenuOpen] = useState(false)
  const [bgImage, setBgImage] = useState(() => localStorage.getItem('yanji-bg-image') || '')
  const bgFileRef = useRef(null)
  const importFileRef = useRef(null)

  const activeChat = getActiveChat()
  // prefer the chat's own connectionId, fall back to global active connection
  const activeConn = activeChat
    ? (connections.find((c) => c.id === activeChat.connectionId) || getActiveConnection())
    : getActiveConnection()
  const messages = activeChatId ? getMessages(activeChatId) : []

  // ── Model panel ──────────────────────────────────────────────────────────
  const provider = activeConn ? normalizeProvider(activeConn.provider) : 'openai'
  const builtinModels = BUILTIN_MODELS[provider] || []
  const currentModel = activeChat?.model || activeConn?.defaultModel || ''
  const currentConnId = activeChat?.connectionId || activeConnectionId || ''

  function handleSelectModel(model) {
    if (activeChat) updateChatModel(activeChat.id, (model || '').trim())
    setModelPanelOpen(false)
  }

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async (text, images) => {
    if (isSending || (!text && !images.length)) return

    let chat = activeChat
    if (!chat) {
      if (!activeConn) {
        showToast('请先在设置里添加一个 API 连接', 'error')
        return
      }
      chat = createChat()
      if (!chat) { showToast('创建对话失败', 'error'); return }
    }

    const conn = connections.find((c) => c.id === chat.connectionId) || activeConn
    if (!conn?.apiKey) { showToast('连接未配置 API Key', 'error'); return }

    // Add user message
    const userMsg = addMessage(chat.id, { role: 'user', content: text, images: images.length ? images : undefined })
    setPendingImages([])

    // Add placeholder assistant message
    const assistantId = uuid()
    addMessage(chat.id, { id: assistantId, role: 'assistant', content: '', streaming: true })

    setIsSending(true)

    try {
      const allMsgs = getMessages(chat.id).filter((m) => !m.streaming)
      // 旧消息的图片降级为占位文本：base64 图片占大量 token，留在历史里每轮都触发缓存重写
      const IMG_KEEP_RECENT = 4
      const limited = applyContextLimit(allMsgs.map((m, i, arr) => {
        const keepImages = i >= arr.length - IMG_KEEP_RECENT
        return {
          role: m.role,
          content: !keepImages && m.images?.length && !m.content ? '[图片]' : m.content,
          images: keepImages ? m.images : undefined,
          thinking: m.thinking || undefined,
          tool_calls: m.tool_calls || undefined,
        }
      }))

      const now = new Date()
      // 时间只精确到小时：system prompt 每分每秒变化会击穿 API 的 prompt 缓存
      const dateStr = now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
      const hourStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false })
      const timeCtx = `当前时间：${dateStr} ${parseInt(hourStr)}点左右`
      const moonCtxParts = [timeCtx]
      if (moonMemory?.enabled && moonMemory?.apiToken) {
        moonCtxParts.push(
          '你连接了拾羽记忆库，有两个工具：\n' +
          '- write_memory：用户明确要求写入/记录，或出现值得记住的重要信息时，立即调用，直接写，不要先搜索。\n' +
          '- search_memories：用户询问过去的事、需要回忆时调用。\n' +
          '写入时无需征询用户同意，直接执行。'
        )
      }
      const systemPrompt = buildSystemPrompt(globalInstruction, memoryItems, moonCtxParts.join('\n\n'))
      let fullText = ''
      let fullThinking = ''

      const result = await sendMessage({
        connection: conn,
        messages: limited,
        systemPrompt,
        model: chat.model || conn.defaultModel,
        generationConfig,
        searchConfig,
        moonMemoryConfig: moonMemory,
        autoTools,
        onChunk: (chunk) => {
          fullText += chunk
          updateMessage(chat.id, assistantId, { content: fullText, streaming: true })
        },
        onThinking: (chunk) => {
          fullThinking += chunk
          updateMessage(chat.id, assistantId, { thinking: fullThinking, streaming: true })
        },
        onStatus: setStatus,
        onToolCall: (toolNames) => {
          updateMessage(chat.id, assistantId, { toolCalls: toolNames })
          setStatus(`调用工具: ${toolNames.join(', ')}`)
        },
      })

      const finalText = result.text || fullText
      const parts = finalText.split(/\[MSG\]/).map((p) => p.trim()).filter(Boolean)
      updateMessage(chat.id, assistantId, {
        content: parts[0] || finalText,
        thinking: fullThinking || undefined,
        streaming: false,
        tokenUsage: result.usage || null,
        toolCalls: undefined,
      })
      for (let i = 1; i < parts.length; i++) {
        await new Promise((r) => setTimeout(r, 700))
        addMessage(chat.id, { role: 'assistant', content: parts[i] })
      }
      touchChat(chat.id)
      if (result.usage) recordTokenUsage(conn.id, result.usage)

      // Auto-title first message
      if (allMsgs.length <= 2 && chat.title === '新对话' && text) {
        const short = text.slice(0, 30).trim()
        store.renameChat(chat.id, short || '新对话')
      }
    } catch (e) {
      removeLastEmptyAssistant(chat.id)
      // 如果是图片格式不被支持的错误，把历史里含图片的消息清掉，避免污染后续对话
      if (e.message?.includes('image_url') || e.message?.includes('image')) {
        const msgs = getMessages(chat.id)
        msgs.forEach((m) => {
          if (m.images?.length) {
            updateMessage(chat.id, m.id, { images: undefined, content: (m.content || '') + '\n[图片，该模型不支持]' })
          }
        })
        addMessage(chat.id, { role: 'assistant', content: '[错误] 该模型不支持图片，已自动清除历史中的图片，可以继续对话。' })
      } else {
        addMessage(chat.id, { role: 'assistant', content: `[错误] ${e.message}` })
      }
      showToast(e.message, 'error')
    } finally {
      setIsSending(false)
      setStatus('')
    }
  }, [isSending, activeChat, activeConn, connections, globalInstruction, memoryItems,
      generationConfig, searchConfig, moonMemory, autoTools])

  const handleEditMessage = useCallback((msg, newText) => {
    if (!newText.trim() || !activeChatId) return
    truncateMessagesFrom(activeChatId, msg.id)
    setTimeout(() => handleSend(newText, []), 0)
  }, [activeChatId, truncateMessagesFrom, handleSend])

  // ── Background image ─────────────────────────────────────────────────────
  function handleBgUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        localStorage.setItem('yanji-bg-image', ev.target.result)
        setBgImage(ev.target.result)
      } catch { showToast('图片太大了，请选小一点的', 'error') }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  function clearBg() {
    localStorage.removeItem('yanji-bg-image')
    setBgImage('')
    setBgMenuOpen(false)
  }

// ── Backup / Restore ─────────────────────────────────────────────────────
  function handleBackupExport() {
    setBgMenuOpen(false)
    const raw = localStorage.getItem('llm_hub_state_v1') || '{}'
    const blob = new Blob([raw], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `yanji-backup-${new Date().toISOString().slice(0,10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleBackupImport(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        JSON.parse(ev.target.result) // validate JSON
        if (!window.confirm('导入会覆盖当前所有对话记录，确定吗？')) return
        localStorage.setItem('llm_hub_state_v1', ev.target.result)
        window.location.reload()
      } catch { showToast('文件格式不对，请选 yanji 导出的 JSON', 'error') }
    }
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  // ── Export ───────────────────────────────────────────────────────────────
  function handleExport() {
    if (!activeChat || !messages.length) return
    const title = activeChat.title || '新对话'
    const model = activeChat.model || activeConn?.name || ''
    const date = new Date(activeChat.updatedAt || Date.now()).toLocaleDateString('zh-CN')

    const lines = [`# ${title}`, ``, `> 模型：${model}　日期：${date}`, ``]
    messages.forEach((m) => {
      if (m.streaming) return
      const role = m.role === 'user' ? '**阿颖**' : '**涟言**'
      lines.push(`### ${role}`, ``)
      if (m.thinking) {
        lines.push(`<details><summary>思考过程</summary>`, ``, m.thinking.trim(), ``, `</details>`, ``)
      }
      lines.push(m.content?.trim() || '', ``, `---`, ``)
    })

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/[\/\\:*?"<>|]/g, '_')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="chat-panel">
      {/* Sidebar */}
      <div className={'chat-sidebar' + (sidebarOpen ? ' open' : '')}>
        <ConversationList onClose={() => setSidebarOpen(false)} />
      </div>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      {/* Main */}
      <div className="chat-main">
        {/* Top bar */}
        <div className="chat-topbar">
          <button className="topbar-btn" onClick={() => setSidebarOpen(true)} title="对话列表">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="topbar-info">
            <span className="topbar-title">{activeChat?.title || '新对话'}</span>
            {activeConn && (
              <button className="topbar-model-btn" onClick={() => setModelPanelOpen(true)}>
                {currentModel || activeConn.name}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4 }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <button className="topbar-btn" onClick={() => setBgMenuOpen((v) => !v)} title="更多">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="19" r="1" fill="currentColor" />
              </svg>
            </button>
          </div>
          {bgMenuOpen && createPortal(
            <div className="bg-menu" onClick={(e) => e.stopPropagation()}>
              {activeChat && messages.length > 0 && (
                <button onClick={() => { setBgMenuOpen(false); handleExport() }}>导出当前对话</button>
              )}
              <button onClick={handleBackupExport}>备份全部数据</button>
              <button onClick={() => { setBgMenuOpen(false); importFileRef.current?.click() }}>恢复备份</button>
              <button onClick={() => { setBgMenuOpen(false); bgFileRef.current?.click() }}>设置背景图</button>
              <button onClick={clearBg}>清除背景图</button>
            </div>,
            document.body
          )}
          <button
            className="topbar-btn"
            onClick={() => {
              const chat = createChat()
              if (chat) setActiveChat(chat.id)
            }}
            title="新对话"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
        </div>

        {/* Model panel */}
        {modelPanelOpen && (
          <div className="model-panel-overlay" onClick={() => setModelPanelOpen(false)}>
            <div className="model-panel" onClick={(e) => e.stopPropagation()}>
              <div className="model-panel-header">
                <span>选择模型</span>
                <button className="model-panel-close" onClick={() => setModelPanelOpen(false)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="model-panel-section">
                <div className="model-panel-label">连接</div>
                <select
                  className="model-conn-select"
                  value={currentConnId}
                  onChange={(e) => {
                    if (activeChat) updateChatConnection(activeChat.id, e.target.value)
                    else store.setActiveConnection(e.target.value)
                  }}
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              {builtinModels.length > 0 && (
                <div className="model-panel-section">
                  <div className="model-panel-label">预设模型</div>
                  <div className="model-list">
                    {builtinModels.map((m) => (
                      <button
                        key={m}
                        className={'model-item' + (currentModel === m ? ' active' : '')}
                        onClick={() => handleSelectModel(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="model-panel-section">
                <div className="model-panel-label">自定义模型</div>
                <div className="model-custom-row">
                  <input
                    key={currentConnId}
                    className="model-custom-input"
                    placeholder="输入模型名称..."
                    defaultValue={currentModel}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSelectModel(e.target.value) }}
                  />
                  <button className="btn-sm btn-primary" onClick={(e) => {
                    const input = e.target.closest('.model-panel-section').querySelector('input')
                    if (input?.value) handleSelectModel(input.value)
                  }}>确认</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div
          className="chat-messages"
          style={bgImage ? { backgroundImage: `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
          onClick={() => bgMenuOpen && setBgMenuOpen(false)}
        >
          {!activeConn ? (
            <div className="messages-empty">
              <p className="messages-empty-hint">
                请先在<button className="link-btn" onClick={() => store.setActivePanel('settings')}>设置</button>里添加 API 连接
              </p>
            </div>
          ) : (
            <MessageList messages={messages} status={status} onEdit={handleEditMessage} />
          )}
        </div>

        {/* Input */}
        <ChatInput
          disabled={isSending || !activeConn}
          onSend={handleSend}
          images={pendingImages}
          onImageAdd={(src) => setPendingImages((p) => [...p, src])}
          onImageRemove={(i) => setPendingImages((p) => p.filter((_, idx) => idx !== i))}
        />
        <input ref={bgFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBgUpload} />
        <input ref={importFileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleBackupImport} />
      </div>
    </div>
  )
}
