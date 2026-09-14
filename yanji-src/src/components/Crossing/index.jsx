import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'

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

function threadsFromRead(thread) {
  const out = []
  for (const turn of thread?.turns || []) {
    for (const item of turn.items || []) {
      if (item.type === 'userMessage') out.push({ id: item.id, role: 'user', text: (item.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('') })
      if (item.type === 'agentMessage') out.push({ id: item.id, role: 'assistant', text: item.text || '' })
    }
  }
  return out
}

function usageText(usage) {
  if (!usage?.primary && !usage?.secondary) return '用量暂不可用'
  const one = usage.primary ? `5h ${usage.primary.usedPercent}%` : ''
  const two = usage.secondary ? `7天 ${usage.secondary.usedPercent}%` : ''
  return [one, two].filter(Boolean).join(' · ') + (usage.source === 'snapshot' ? ' · 快照' : '')
}

export default function Crossing() {
  const moonMemory = useStore((s) => s.moonMemory)
  const setActivePanel = useStore((s) => s.setActivePanel)
  const wsRef = useRef(null)
  const reconnectRef = useRef(null)
  const activeThreadRef = useRef('')
  const scrollRef = useRef(null)
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

  useEffect(() => { activeThreadRef.current = activeThread?.id || activeThread?.threadId || '' }, [activeThread])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, items, approval])

  const send = useCallback((payload) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) throw new Error('渡口尚未连接')
    wsRef.current.send(JSON.stringify(payload))
  }, [])

  const readThread = useCallback((threadId, resume = true) => {
    if (!threadId) return
    send({ type: resume ? 'crossing/thread/resume' : 'crossing/thread/read', threadId })
  }, [send])

  useEffect(() => {
    if (!moonMemory?.apiToken) { setConnection('needs-setup'); return undefined }
    let disposed = false
    const connect = () => {
      if (disposed) return
      setConnection('connecting'); setError('')
      let ws
      try { ws = new WebSocket(wsUrl(moonMemory.baseUrl)) }
      catch { setConnection('error'); setError('渡口地址无效'); return }
      wsRef.current = ws
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'crossing/auth', token: moonMemory.apiToken }))
        ws.send(JSON.stringify({ type: 'crossing/thread/list' }))
        ws.send(JSON.stringify({ type: 'crossing/usage/read' }))
      }
      ws.onmessage = (raw) => {
        let msg
        try { msg = JSON.parse(raw.data) } catch { return }
        if (!String(msg.type || '').startsWith('crossing/')) return
        if (msg.type === 'crossing/auth_failed') { setConnection('error'); setError('渡口身份验证失败'); ws.close(); return }
        if (msg.type === 'crossing/status') { setConnection(msg.state || 'online'); if (msg.error) setError(msg.error); return }
        if (msg.type === 'crossing/error') { setError(msg.error || '渡口操作失败'); return }
        if (msg.type === 'crossing/threads') { setThreads(msg.threads || []); return }
        if (msg.type === 'crossing/usage') { setUsage(msg.usage || null); return }
        if (msg.type === 'crossing/thread') {
          const thread = msg.thread
          if (!thread) return
          const id = thread.id || thread.threadId
          setActiveThread(thread)
          if (msg.action === 'read' || msg.action === 'resumed') setMessages(threadsFromRead(thread))
          setItems([]); setTurn(null); setApproval(null)
          if (id) send({ type: 'crossing/thread/list' })
          return
        }
        if (msg.type === 'crossing/turn/started') { setTurn(msg.turn); return }
        if (msg.type === 'crossing/turn/completed') { setTurn(null); setApproval(null); return }
        if (msg.type === 'crossing/turn/interrupted') { setTurn(null); return }
        if (msg.type === 'crossing/message/delta') {
          if (msg.threadId !== activeThreadRef.current) return
          setMessages((previous) => {
            const i = previous.findIndex((entry) => entry.id === msg.itemId)
            if (i < 0) return [...previous, { id: msg.itemId, role: 'assistant', text: msg.delta || '', streaming: true }]
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
        if (disposed) return
        setConnection('reconnecting')
        reconnectRef.current = setTimeout(connect, 2500)
      }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => { disposed = true; clearTimeout(reconnectRef.current); try { wsRef.current?.close() } catch {} }
  }, [moonMemory?.apiToken, moonMemory?.baseUrl, send])

  const createThread = () => { try { send({ type: 'crossing/thread/start' }) } catch (e) { setError(e.message) } }
  const startTurn = () => {
    const text = draft.trim()
    if (!text || turn) return
    if (text === '/new') { setDraft(''); createThread(); return }
    if (text === '/sessions') { setDraft(''); send({ type: 'crossing/thread/list' }); return }
    if (text.startsWith('/resume')) { setDraft(''); const id = text.slice(7).trim(); if (id) readThread(id); else setError('用法：/resume 会话编号'); return }
    const threadId = activeThread?.id || activeThread?.threadId
    if (!threadId) { setError('请先新建或选择一个会话'); return }
    const clientMessageId = crypto.randomUUID()
    setMessages((previous) => [...previous, { id: clientMessageId, role: 'user', text }])
    setDraft('')
    try { send({ type: 'crossing/turn/start', threadId, text, clientMessageId }) } catch (e) { setError(e.message) }
  }
  const interrupt = () => { if (turn && activeThread) send({ type: 'crossing/turn/interrupt', threadId: activeThread.id || activeThread.threadId, turnId: turn.id }) }
  const respond = (choice) => {
    if (!approval) return
    send({ type: 'crossing/approval/respond', choice, requestId: approval.requestId, threadId: approval.threadId, turnId: approval.turnId, itemId: approval.itemId })
    setApproval(null)
  }

  const activeId = activeThread?.id || activeThread?.threadId
  const toolItems = useMemo(() => items.filter((item) => item.type !== 'reasoning'), [items])
  if (!moonMemory?.apiToken) return <div className="panel-shell crossing-panel"><div className="panel-empty">渡口需要先在「拾羽」中配置记忆库连接。</div></div>

  return (
    <div className="panel-shell crossing-panel">
      <div className="panel-topbar crossing-topbar">
        <button className="topbar-btn" onClick={() => setActivePanel('chat')} title="回到 Murmur">←</button>
        <div className="crossing-title"><h2 className="panel-title">渡口</h2><span>Codex · {connection === 'online' ? '已连接' : connection === 'idle' ? '待唤醒' : connection === 'reconnecting' ? '重连中' : connection === 'connecting' ? '连接中' : '离线'}</span></div>
        <button className="topbar-btn" onClick={createThread} title="新建 Codex 会话">＋</button>
      </div>
      <div className="crossing-meta"><span>{usageText(usage)}</span>{compacting && <span className="crossing-compacting">正在压缩上下文…</span>}</div>
      {error && <div className="crossing-error">{error}<button onClick={() => setError('')}>×</button></div>}
      <div className="crossing-layout">
        <aside className="crossing-sessions">
          <div className="crossing-session-head"><span>会话</span><button onClick={() => send({ type: 'crossing/thread/list' })}>刷新</button></div>
          {threads.map((thread) => <button key={thread.id} className={'crossing-session' + (thread.id === activeId ? ' active' : '')} onClick={() => readThread(thread.id)}><b>{thread.name || '未命名会话'}</b><small>{thread.preview || compactTime(thread.updatedAt)}</small></button>)}
          {!threads.length && <div className="crossing-empty">还没有 Codex 会话</div>}
        </aside>
        <main className="crossing-chat">
          <div className="crossing-messages" ref={scrollRef}>
            {!activeThread && <div className="crossing-empty">新建会话后，即可在这里和 Codex 协作。</div>}
            {messages.map((message) => <div key={message.id} className={'crossing-bubble ' + (message.role === 'user' ? 'bubble-user' : 'bubble-assistant')}><div className="bubble-text">{message.text}{message.streaming && <span className="crossing-caret" />}</div></div>)}
            {toolItems.map((item) => <details key={item.id} className={'crossing-tool ' + (item.status === 'failed' ? 'failed' : '')}><summary>{item.lifecycle === 'started' ? '正在' : '已完成'} · {item.title || '工具调用'}{item.exitCode != null ? `（${item.exitCode}）` : ''}</summary>{item.cwd && <div className="crossing-path">{item.cwd}</div>}{item.output && <pre>{item.output}</pre>}{item.error && <pre>{item.error}</pre>}{item.paths?.length ? <div className="crossing-path">{item.paths.join('\n')}</div> : null}</details>)}
            {turn && <div className="crossing-working">Codex 正在工作…</div>}
          </div>
          <div className="crossing-input"><textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startTurn() } }} placeholder={activeThread ? '输入消息；/new、/sessions、/resume 会映射为渡口操作' : '先新建或选择会话'} disabled={connection !== 'online' && connection !== 'idle'} rows="2" />{turn ? <button className="crossing-stop" onClick={interrupt}>停止</button> : <button className="send-btn" onClick={startTurn}>发送</button>}</div>
        </main>
      </div>
      {approval && <div className="crossing-approval-backdrop"><div className="crossing-approval"><b>Codex 需要本次授权</b><p>{approval.kind === 'file-change' ? '准备修改文件' : '准备执行命令'}</p>{approval.command && <pre>{approval.command}</pre>}{approval.reason && <p>{approval.reason}</p>}<small>{approval.cwd}</small><div><button className="crossing-deny" onClick={() => respond('deny')}>拒绝</button><button onClick={() => respond('allow')}>允许本次</button></div></div></div>}
    </div>
  )
}
