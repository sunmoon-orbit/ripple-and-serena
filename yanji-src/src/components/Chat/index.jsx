import { useState, useCallback } from 'react'
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
    recordTokenUsage, updateChatModel, applyContextLimit,
  } = store

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [modelPanelOpen, setModelPanelOpen] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [status, setStatus] = useState('')
  const [pendingImages, setPendingImages] = useState([])

  const activeChat = getActiveChat()
  const activeConn = getActiveConnection()
  const messages = activeChatId ? getMessages(activeChatId) : []

  // ── Model panel ──────────────────────────────────────────────────────────
  const provider = activeConn ? normalizeProvider(activeConn.provider) : 'openai'
  const builtinModels = BUILTIN_MODELS[provider] || []
  const currentModel = activeChat?.model || activeConn?.defaultModel || ''

  function handleSelectModel(model) {
    if (activeChat) updateChatModel(activeChat.id, model)
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
      const limited = applyContextLimit(allMsgs.map((m) => ({ role: m.role, content: m.content, images: m.images, thinking: m.thinking || undefined, tool_calls: m.tool_calls || undefined })))

      const now = new Date()
      const timeCtx = `当前时间：${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`
      const systemPrompt = buildSystemPrompt(globalInstruction, memoryItems, timeCtx)
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

      updateMessage(chat.id, assistantId, {
        content: result.text || fullText,
        thinking: fullThinking || undefined,
        streaming: false,
        tokenUsage: result.usage || null,
        toolCalls: undefined,
      })
      touchChat(chat.id)
      if (result.usage) recordTokenUsage(conn.id, result.usage)

      // Auto-title first message
      if (allMsgs.length <= 2 && chat.title === '新对话' && text) {
        const short = text.slice(0, 30).trim()
        store.renameChat(chat.id, short || '新对话')
      }
    } catch (e) {
      removeLastEmptyAssistant(chat.id)
      addMessage(chat.id, { role: 'assistant', content: `[错误] ${e.message}` })
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
                  value={activeConnectionId || ''}
                  onChange={(e) => store.setActiveConnection(e.target.value)}
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
        <div className="chat-messages">
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
          moonEnabled={moonMemory?.enabled}
        />
      </div>
    </div>
  )
}
