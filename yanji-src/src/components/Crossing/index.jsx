import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ToolMemoryContext } from '../Chat/ToolMemory'
import { useStore } from '../../store'
import { createSessionFlow } from './session-flow.mjs'
import { localCommand, imageSupported, modelLabel, uploadAttachment } from './controls.mjs'
import { StickerPicker, stickerURL } from '../Chat/StickerPicker'
import { AttachmentPicker } from '../Chat/AttachmentPicker'
import CrossingTools from './Tools'
import { sizeComposer } from './layout.mjs'
import CrossingMessage from './Message'
import { threadsFromRead, completeTurn } from './messages.mjs'
import { bindAgentSession, canAuthenticate } from './authorization.mjs'

function wsUrl(baseUrl) {
  const base = new URL(baseUrl || 'https://memory.ravenlove.cc')
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  base.pathname = '/raven/ws'
  base.search = ''
  base.hash = ''
  return base.href
}

function compactTime(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function usageText(usage) {
  if (!usage?.primary && !usage?.secondary) return '用量暂不可用'
  const one = usage.primary ? `5h ${usage.primary.usedPercent}%` : ''
  const two = usage.secondary ? `7天 ${usage.secondary.usedPercent}%` : ''
  return [one, two].filter(Boolean).join(' · ') + (usage.source === 'snapshot' ? ' · 快照' : '')
}

export default function Crossing() {
  const moonMemory = useStore((s) => s.moonMemory)
  const agentBlocked = useStore(s => s.agentBlocked)
  const [capability, setCapability] = useState('')
  const customStickers = useStore((s) => s.customStickers) || []
  const setActivePanel = useStore((s) => s.setActivePanel)
  const wsRef = useRef(null)
  const reconnectRef = useRef(null)
  const activeThreadRef = useRef('')
  const scrollRef = useRef(null)
  const panelRef = useRef(null)
  const [connection, setConnection] = useState('connecting')
  const [error, setError] = useState('')
  const [threads, setThreads] = useState([])
  const [activeThread, setActiveThread] = useState(null)
  const [messages, setMessages] = useState([])
  const [items, setItems] = useState([])
  const [draft, setDraft] = useState('')
  const [turn, setTurn] = useState(null)
  const [approval, setApproval] = useState(null)
  const [usage, setUsage] = useState(null)
  const [compacting, setCompacting] = useState(false)
  const [sessionState, setSessionState] = useState({ phase: 'disconnected' })
  const [sessionsOpen, setSessionsOpen] = useState(true)
  const [starting, setStarting] = useState(false)
  const inputRef = useRef(null)
  const flowRef = useRef(null)
  const fileRef = useRef(null)
  const [models, setModels] = useState([])
  const [modelOpen, setModelOpen] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [selection, setSelection] = useState({ model: '', effort: '' })
  const [attachments, setAttachments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [stickerOpen, setStickerOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [warning, setWarning] = useState('')
  const [stopEpoch, setStopEpoch] = useState(0)

  useEffect(() => { activeThreadRef.current = activeThread?.id || activeThread?.threadId || '' }, [activeThread])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, items, approval])
  useEffect(() => {
    // Android Chrome normally resizes only the visual viewport for the IME.
    const viewport = window.visualViewport
    const resize = () => panelRef.current?.style.setProperty('--crossing-viewport-height', `${viewport?.height || window.innerHeight}px`)
    resize()
    viewport?.addEventListener('resize', resize)
    window.addEventListener('resize', resize)
    return () => { viewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize) }
  }, [capability])

  const send = useCallback((payload) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) throw new Error('渡口尚未连接')
    wsRef.current.send(JSON.stringify(payload))
  }, [])
  if (!flowRef.current) flowRef.current = createSessionFlow(send, (state) => {
    setSessionState(state)
    if (state.error) setError(state.error)
    if (state.phase === 'ready') {
      activeThreadRef.current = state.thread.id
      setActiveThread(state.thread)
      setSelection(state.pendingModel || { model: state.thread.model || '', effort: state.thread.reasoningEffort || '' })
      setMessages(threadsFromRead(state.thread))
      setItems([]); setTurn(null); setStarting(false); setApproval(null); setError(''); setSessionsOpen(false)
    }
  }, {
    threadId: useStore.getState().navigation.threadId,
    rememberThread: id => useStore.getState().rememberCrossingThread(id),
  })
  useEffect(() => {
    const node = inputRef.current
    if (!node) return
    const resize = () => sizeComposer(node)
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(node.parentElement)
    window.visualViewport?.addEventListener('resize', resize)
    return () => { observer.disconnect(); window.visualViewport?.removeEventListener('resize', resize) }
  }, [draft, capability])

  const readThread = useCallback((threadId) => {
    if (!threadId) return
    if (!turn && !starting) { setStopEpoch(n => n + 1); flowRef.current.select(threadId) }
  }, [turn, starting])

  useEffect(() => {
    if (!canAuthenticate(moonMemory) || agentBlocked) { flowRef.current.disconnect(); setCapability(''); setConnection('locked'); return undefined }
    let disposed = false
    let denied = false
    const lock = () => {
      denied = true; setCapability(''); flowRef.current.disconnect(); setMessages([]); setThreads([]); setModels([]); setUsage(null); setApproval(null); setTurn(null); setAttachments([]); setStopEpoch(n => n + 1)
      setConnection('locked'); clearTimeout(reconnectRef.current); clearTimeout(expiryTimer)
      try { wsRef.current?.close() } catch {}
    }
    const unbind = bindAgentSession(lock)
    let expiryTimer
    const connect = () => {
      if (disposed) return
      setConnection('connecting'); setError('')
      let ws
      try { ws = new WebSocket(wsUrl(moonMemory.baseUrl)) }
      catch { setConnection('error'); setError('渡口地址无效'); return }
      wsRef.current = ws
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'crossing/auth', token: moonMemory.apiToken, enabled: true }))
      }
      ws.onmessage = (raw) => {
        if (disposed || wsRef.current !== ws) return
        let msg
        try { msg = JSON.parse(raw.data) } catch { return }
        if (!String(msg.type || '').startsWith('crossing/')) return
        if (msg.type === 'crossing/auth_failed') { lock(); return }
        if (msg.type === 'crossing/authenticated') {
          if (!msg.capability || !Number.isFinite(msg.expiresAt) || msg.expiresAt <= Date.now()) { lock(); return }
          clearTimeout(expiryTimer)
          expiryTimer = setTimeout(lock, Math.min(msg.expiresAt - Date.now(), 15 * 60000))
          setCapability(msg.capability)
        }
        flowRef.current.receive(msg)
        if (msg.type === 'crossing/models') {
          setModels(msg.models || []); setModelsError('')
          setSelection(prev => prev.model ? prev : (() => { const m = msg.models?.find(m => m.isDefault) || msg.models?.[0]; return m ? { model: m.model, effort: m.defaultReasoningEffort } : prev })())
          return
        }
        if (msg.type === 'crossing/warning') { if (!msg.threadId || msg.threadId === activeThreadRef.current) setWarning(msg.message); return }
        if (msg.type === 'crossing/model/confirmed') {
          if (msg.threadId === activeThreadRef.current) {
            setActiveThread(prev => ({ ...prev, model: msg.model, reasoningEffort: msg.reasoningEffort }))
            setSessionState(prev => prev.pendingModel?.model === msg.model && prev.pendingModel?.effort === msg.reasoningEffort ? { ...prev, pendingModel: null } : prev)
          }
          return
        }
        if (msg.type === 'crossing/status') {
          setConnection(msg.state || 'online')
          if (['offline', 'error'].includes(msg.state)) { setStopEpoch(n => n + 1); setTurn(null); setStarting(false); setApproval(null) }
          if (msg.error) setError(msg.error)
          return
        }
        if (msg.type === 'crossing/error') { setStarting(false); if (msg.operation === 'crossing/model/list') setModelsError(msg.error || '模型列表读取失败'); else setError(msg.error || '渡口操作失败'); return }
        if (msg.type === 'crossing/threads') { setThreads(msg.threads || []); return }
        if (msg.type === 'crossing/usage') { setUsage(msg.usage || null); return }
        if (msg.type === 'crossing/thread') {
          return
        }
        if (msg.threadId && msg.threadId !== activeThreadRef.current) return
        if (msg.type === 'crossing/turn/started') { setStarting(false); setTurn(msg.turn); return }
        if (msg.type === 'crossing/turn/completed') { setMessages(previous => completeTurn(previous, msg.turn)); setStarting(false); setTurn(null); setApproval(null); return }
        if (msg.type === 'crossing/turn/interrupted') { setStopEpoch(n => n + 1); setTurn(null); return }
        if (msg.type === 'crossing/message/delta') {
          if (msg.threadId !== activeThreadRef.current) return
          setMessages((previous) => {
            const i = previous.findIndex((entry) => entry.id === msg.itemId)
            if (i < 0) return [...previous, { id: msg.itemId, turnId: msg.turnId, role: 'assistant', text: msg.delta || '', streaming: true, completed: false }]
            const next = [...previous]; next[i] = { ...next[i], text: next[i].text + (msg.delta || ''), streaming: true }; return next
          })
          return
        }
        if (msg.type === 'crossing/item') {
          if (msg.threadId !== activeThreadRef.current) return
          if (msg.summary?.type === 'agentMessage' && msg.lifecycle === 'completed') {
            setMessages((previous) => previous.map((entry) => entry.id === msg.summary.id ? { ...entry, streaming: false } : entry))
          }
          if (msg.summary?.type !== 'agentMessage' && msg.summary?.type !== 'userMessage') {
            setItems((previous) => {
              const i = previous.findIndex((entry) => entry.id === msg.summary?.id)
              const next = { ...msg.summary, lifecycle: msg.lifecycle }
              return i < 0 ? [...previous, next] : previous.map((entry, index) => index === i ? { ...entry, ...next } : entry)
            })
          }
          return
        }
        if (msg.type === 'crossing/context-compaction') { setCompacting(msg.lifecycle !== 'completed'); return }
        if (msg.type === 'crossing/approval/request') { setApproval(msg); return }
        if (msg.type === 'crossing/approval/resolved') { setApproval((current) => current?.requestId === msg.requestId ? null : current); return }
      }
      ws.onclose = () => {
        if (disposed || denied) return
        clearTimeout(expiryTimer); setCapability('')
        flowRef.current.disconnect(); setStopEpoch(n => n + 1); setTurn(null); setStarting(false); setApproval(null)
        setConnection('reconnecting')
        reconnectRef.current = setTimeout(connect, 2500)
      }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => { disposed = true; unbind(); clearTimeout(expiryTimer); clearTimeout(reconnectRef.current); try { wsRef.current?.close() } catch {} }
  }, [moonMemory?.apiToken, moonMemory?.baseUrl, moonMemory?.enabled, agentBlocked, send])

  const createThread = () => { if (turn || starting) return; setStopEpoch(n => n + 1); try { flowRef.current.create(selection.model ? selection : undefined) } catch (e) { setError(e.message) } }
  const startTurn = () => {
    const text = draft.trim()
    if ((!text && !attachments.length) || turn || starting || uploading || !sessionState.authenticated || sessionState.phase === 'loading') return
    const command = localCommand(text)
    if (command?.name === 'model') { setDraft(''); setModelOpen(true); send({ type: 'crossing/model/list' }); return }
    if (command?.name === 'new') { setDraft(''); createThread(); return }
    if (command?.name === 'sessions') { setDraft(''); setSessionsOpen(true); send({ type: 'crossing/thread/list' }); return }
    if (command?.name === 'resume') { setDraft(''); if (command.argument) readThread(command.argument); else setError('用法：/resume 会话编号'); return }
    const clientMessageId = crypto.randomUUID()
    try { if (!flowRef.current.start(text, clientMessageId, { attachments: attachments.map(({ id, url }) => id ? { id } : { url }) })) return } catch (e) { setError(e.message); return }
    setStarting(true)
    setMessages((previous) => [...previous, { id: clientMessageId, role: 'user', text: [text, ...attachments.map(a => `[附件：${a.name}]`)].filter(Boolean).join('\n'), previews: attachments.filter(a => a.kind === 'image').map(a => a.preview || a.url) }])
    setAttachments([])
    setDraft('')
  }
  const interrupt = () => { setStopEpoch(n => n + 1); if (turn && activeThread) send({ type: 'crossing/turn/interrupt', threadId: activeThread.id || activeThread.threadId, turnId: turn.id }) }
  const respond = (choice) => {
    if (!approval) return
    send({ type: 'crossing/approval/respond', choice, requestId: approval.requestId, threadId: approval.threadId, turnId: approval.turnId, itemId: approval.itemId })
    setApproval(null)
  }

  const activeId = sessionState.phase === 'ready' ? activeThread?.id : ''
  const shortcut = !!localCommand(draft)
  const selectedEntry = models.find(m => m.model === selection.model)
  const imagesAllowed = sessionState.phase === 'ready' && imageSupported(models, sessionState.pendingModel?.model || activeThread?.model)
  const addFile = async file => {
    if (file.kind === 'image' && !imagesAllowed) throw new Error('当前模型不支持图片，或模型尚未确认')
    const attachment = await uploadAttachment({ ...moonMemory, apiToken: capability }, file)
    setAttachments(prev => [...prev, attachment].slice(0, 4))
  }
  const addSticker = name => {
    if (!imagesAllowed) return
    const url = stickerURL(name)
    if (!/^https:\/\/memory\.ravenlove\.cc\/raven\/stickers\/[\w.-]+\.(png|jpe?g|webp|gif)$/i.test(url)) { setError('此自定义贴图链接无法安全直传，请下载后通过图片入口添加'); return }
    setAttachments(prev => [...prev, { url, name: '表情包', kind: 'image' }].slice(0, 4)); setStickerOpen(false)
  }
  const toolItems = useMemo(() => items.filter((item) => item.type !== 'reasoning'), [items])
  if (!canAuthenticate(moonMemory) || agentBlocked || !sessionState.authenticated || !capability) return <div className="panel-shell crossing-panel"><div className="panel-empty"><p>渡口已锁定</p><p>{connection === 'reconnecting' ? '连接已断开，重连中；正在重新验证身份…' : connection === 'connecting' ? '正在验证拾羽记忆库连接…' : '请启用拾羽记忆库，并验证 API Token。'}</p><button className="btn-sm" onClick={() => setActivePanel('settings', 'moon-settings')}>前往设置</button></div></div>

  return (
    <div ref={panelRef} className="panel-shell crossing-panel">
      <div className="panel-topbar crossing-topbar">
        <button className="topbar-btn" onClick={() => setActivePanel('chat', 'api-back')} title="回到 Murmur">←</button>
        <div className="crossing-title"><h2 className="panel-title">渡口</h2><span>Codex · {sessionState.phase === 'ready' ? '会话就绪' : sessionState.phase === 'loading' ? '正在加载会话…' : sessionState.authenticated ? '请选择或新建会话' : connection === 'reconnecting' ? '重连中' : '连接中'}</span></div>
        <button className="topbar-btn" onClick={() => setSessionsOpen(!sessionsOpen)} aria-expanded={sessionsOpen}>会话</button>
        <button className="topbar-btn" disabled={!sessionState.authenticated || sessionState.phase === 'loading' || !!turn || starting} onClick={createThread} title="新建 Codex 会话">＋</button>
      </div>
      <div className="crossing-meta"><span>{usageText(usage)}</span>{compacting && <span className="crossing-compacting">正在压缩上下文…</span>}</div>
      <div className="crossing-meta"><button onClick={() => { setModelOpen(!modelOpen); if (!models.length) send({ type: 'crossing/model/list' }) }} disabled={!sessionState.authenticated}>{modelLabel(sessionState.phase === 'ready' ? activeThread : null)}</button><button onClick={() => setToolsOpen(!toolsOpen)}>工具</button></div>
      {sessionState.pendingModel && <div className="crossing-meta" role="status">待下一轮应用：{sessionState.pendingModel.model} · {sessionState.pendingModel.effort}（未确认执行）</div>}
      {modelsError && <div className="crossing-error" role="alert">{modelsError}<button onClick={() => send({ type: 'crossing/model/list' })}>重试</button></div>}
      {modelOpen && <div className="crossing-controls">
        <label>模型<select value={selection.model} onChange={e => { const m = models.find(x => x.model === e.target.value); setSelection({ model: m.model, effort: m.defaultReasoningEffort }) }}><option value="" disabled>请选择模型</option>{models.map(m => <option key={m.id} value={m.model}>{m.displayName}{m.isDefault ? '（默认）' : ''}</option>)}</select></label>
        <label>推理强度<select value={selection.effort} onChange={e => setSelection(prev => ({ ...prev, effort: e.target.value }))}><option value="" disabled>默认／未知</option>{selectedEntry?.supportedReasoningEfforts.map(e => <option key={e.reasoningEffort} value={e.reasoningEffort}>{e.reasoningEffort}</option>)}</select></label>
        <button disabled={!selection.model || !selection.effort || !!turn || starting || !sessionState.authenticated || sessionState.phase === 'loading'} onClick={() => { if (sessionState.thread?.id) flowRef.current.switchModel(selection); setModelOpen(false) }}>{sessionState.thread?.id ? '应用到当前会话' : '用于新建会话'}</button>
        <button onClick={() => { setModelsError(''); send({ type: 'crossing/model/list' }) }}>刷新列表</button>
        {modelsError && <p role="alert">{modelsError}</p>}
        {selection.model && models.length > 0 && !selectedEntry && <p role="alert">当前会话模型不在可用列表中，请重新选择。</p>}
        <small>顶部只显示服务端确认值；选择仅作用于渡口会话。{sessionState.pendingModel && '所选模型将在下一次发送时覆盖，当前仍显示已确认模型。'}</small>
      </div>}
      {toolsOpen && <div className="crossing-controls"><ToolMemoryContext.Provider value={{ ...moonMemory, baseUrl: `crossing+${moonMemory.baseUrl}`, apiToken: capability }}><CrossingTools /></ToolMemoryContext.Provider></div>}
      {warning && <div className="crossing-error" role="status">{warning}<button onClick={() => setWarning('')}>×</button></div>}
      {error && <div className="crossing-error">{error}<button onClick={() => setError('')}>×</button></div>}
      <div className="crossing-layout">
        <aside className="crossing-sessions" hidden={!sessionsOpen}>
          <div className="crossing-session-head"><span>会话</span><button onClick={() => send({ type: 'crossing/thread/list' })}>刷新</button></div>
          {threads.map((thread) => <button disabled={sessionState.phase === 'loading' || !!turn || starting} key={thread.id} className={'crossing-session' + (thread.id === activeId ? ' active' : '')} onClick={() => readThread(thread.id)}><b>{thread.name === '未命名会话' ? thread.preview || thread.name : thread.name}</b><small>{compactTime(thread.updatedAt)} · {thread.id.slice(0, 8)}</small></button>)}
          {!threads.length && <div className="crossing-empty">还没有 Codex 会话</div>}
        </aside>
        <main className="crossing-chat">
          <div className="crossing-messages" ref={scrollRef}>
            {!activeThread && <div className="crossing-empty">新建会话后，即可在这里和 Codex 协作。</div>}
            {messages.map(message => <CrossingMessage key={`${activeId}:${message.id}`} message={message} config={{ ...moonMemory, apiToken: capability, crossing: true }} stopEpoch={stopEpoch} />)}
            {toolItems.map((item) => <details key={item.id} className={'crossing-tool ' + (item.status === 'failed' ? 'failed' : '')}><summary>{item.lifecycle === 'started' ? '正在' : '已完成'} · {item.title || '工具调用'}{item.exitCode != null ? `（${item.exitCode}）` : ''}</summary>{item.cwd && <div className="crossing-path">{item.cwd}</div>}{item.output && <pre>{item.output}</pre>}{item.error && <pre>{item.error}</pre>}{item.paths?.length ? <div className="crossing-path">{item.paths.join('\n')}</div> : null}</details>)}
            {turn && <div className="crossing-working">Codex 正在工作…</div>}
          </div>
          {stickerOpen && <div className="crossing-stickers"><StickerPicker customStickers={customStickers} onSelect={addSticker} /></div>}
          {!!attachments.length && <div className="crossing-attachments">{attachments.map((a, i) => <div key={a.id || i}>{a.kind === 'image' && <img src={a.preview || a.url} alt="待发图片" />}<span>{a.name}</span><button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}>移除</button></div>)}</div>}
          <div className="crossing-attachment-actions"><button disabled={!sessionState.authenticated || uploading || attachments.length >= 4} onClick={() => fileRef.current?.click()}>{uploading ? '上传中…' : imagesAllowed ? '图片／文件' : '文本文件'}</button><button disabled={!imagesAllowed || attachments.length >= 4} onClick={() => setStickerOpen(!stickerOpen)}>表情包</button>{!imagesAllowed && <small>模型未知或不支持图片</small>}</div>
          <AttachmentPicker strict ref={fileRef} imagesAllowed={imagesAllowed} onAttachment={addFile} onError={setError} onBusy={setUploading} />
          <div className="crossing-input"><textarea ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); startTurn() } }} placeholder={sessionState.phase === 'ready' ? '输入消息；/model 选择模型' : sessionState.phase === 'loading' ? '正在加载会话…' : '先点击＋新建，或选择历史会话'} disabled={!sessionState.authenticated} rows="1" />{turn ? <button className="crossing-stop" onClick={interrupt}>停止</button> : <button disabled={(!shortcut && sessionState.phase !== 'ready') || !sessionState.authenticated || sessionState.phase === 'loading' || (!draft.trim() && !attachments.length) || starting || uploading} onClick={startTurn}>{starting ? '提交中' : shortcut ? '执行' : '发送'}</button>}</div>
        </main>
      </div>
      {approval && <div className="crossing-approval-backdrop"><div className="crossing-approval"><b>Codex 需要本次授权</b><p>{approval.kind === 'file-change' ? '准备修改文件' : '准备执行命令'}</p>{approval.command && <pre>{approval.command}</pre>}{approval.reason && <p>{approval.reason}</p>}<small>{approval.cwd}</small><div><button className="crossing-deny" onClick={() => respond('deny')}>拒绝</button><button onClick={() => respond('allow')}>允许本次</button></div></div></div>}
    </div>
  )
}
