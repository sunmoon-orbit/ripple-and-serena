// 言叽·渡口的传输无关服务层。
// Codex 是唯一活动 Agent；未来若接入 Claude Code，应实现同一接口并在
// activateAgent 中互斥切换，不能并行运行两个 agent runtime。
const { CodexAppServer, clip } = require('./codex-app-server')
const { createModelControls, threadOverrides, confirmedModel } = require('./crossing-models')
const { createUploadStore } = require('./crossing-uploads')
const { OPERATIONS } = require('./crossing-auth')

const APPROVAL_TIMEOUT_MS = 2 * 60 * 1000
const DEFAULT_CWD = pathSafe(process.env.YANJI_CROSSING_CWD || pathJoinParent())

function pathJoinParent() {
  return require('path').resolve(__dirname, '..')
}

function pathSafe(value) { return String(value || pathJoinParent()) }

function fallbackRateLimits(file = '/var/lib/ai-usage/codex.json') {
  try {
    const data = JSON.parse(require('fs').readFileSync(file, 'utf8'))
    if (!data?.available) return null
    const window = (entry) => entry ? {
      usedPercent: Number(entry.used_percent) || 0,
      resetsAt: Number(entry.reset_at) ? Number(entry.reset_at) * 1000 : null,
      windowDurationMins: null,
    } : null
    return { source: 'snapshot', planType: data.plan || '', limitReached: data.limit_reached ? 'limit_reached' : null, primary: window(data.primary), secondary: window(data.secondary) }
  } catch { return null }
}

function publicThread(thread) {
  if (!thread || typeof thread !== 'object') return null
  return {
    id: thread.id || thread.threadId || '',
    name: thread.name || thread.title || '未命名会话',
    preview: clip(thread.preview || thread.summary || '', 240),
    createdAt: thread.createdAt || thread.created_at || null,
    updatedAt: thread.updatedAt || thread.updated_at || null,
    cwd: thread.cwd || '',
    model: thread.model || null, reasoningEffort: thread.reasoningEffort ?? null,
  }
}

function input(text) { return [{ type: 'text', text: String(text || '') }] }

function localModelCommand(text) {
  return /^\s*\/model(?:\s+.*)?\s*$/i.test(String(text || ''))
}

function diagnoseCrossingError(error, operation = '') {
  const detail = clip(error?.message || error || 'unknown error', 500)
  const source = `${error?.code || ''} ${detail}`.toLowerCase()
  let code = 'app_server_error'
  if (/unauthorized|permission|forbidden|not allowed/.test(source)) code = 'permission_or_auth'
  else if (/附件|attachment/.test(source) && /(不可用|过期|重新添加|invalid|expired|unavailable)/.test(source)) code = 'invalid_attachment'
  else if (/thread/.test(source) && /(invalid|unknown|not found|missing|mismatch|does not exist)/.test(source)) code = 'invalid_thread'
  else if (/reasoning|effort/.test(source) && /(invalid|unsupported|not support|不可用|不支持)/.test(source)) code = 'invalid_reasoning_effort'
  else if (/model/.test(source) && /(invalid|unknown|not found|unavailable|unsupported|不可用|不支持)/.test(source)) code = 'invalid_model'
  else if (/protocol|json-rpc|invalid params|unknown method|parse error/.test(source)) code = 'app_server_protocol'
  else if (/socket|session|会话尚未恢复|disconnected|已断开|loading|正在加载/.test(source)) code = 'socket_or_session_state'
  return { code, detail }
}

function approvalResult(method, choice) {
  if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
    return { decision: choice === 'allow' ? 'accept' : 'decline' }
  }
  return null
}

function approvalView(request) {
  const p = request.params || {}
  const kind = request.method === 'item/fileChange/requestApproval' ? 'file-change' : 'command'
  return {
    requestId: String(request.id),
    threadId: p.threadId || '', turnId: p.turnId || '', itemId: p.itemId || '',
    kind,
    command: clip(p.command, 1000), cwd: p.cwd || '', reason: clip(p.reason, 600),
  }
}

function createCrossingService(options = {}) {
  const cwd = options.cwd || DEFAULT_CWD
  const adapter = options.adapter || new CodexAppServer({ cwd, spawn: options.spawn, command: options.command, args: options.args })
  const broadcast = options.broadcast || (() => {})
  const send = options.send || (() => {})
  const rateLimitFallback = options.rateLimitFallback || fallbackRateLimits
  let activeTurn = null
  let startingTurn = null
  const disconnectedClients = new Set()
  const approvals = new Map()
  const sessions = new Map()
  const allowedThreads = new Map()
  const authorize = options.authorize || (() => false)
  const attachmentOwner = options.attachmentOwner || (id => id)
  const retainUploadsOnDisconnect = options.retainUploadsOnDisconnect === true
  const check = id => { if (!authorize(id) || disconnectedClients.has(id)) throw new Error('unauthorized') }
  const selecting = new Set()
  const modelControls = createModelControls(adapter, options.modelStateFile)
  const uploads = options.uploads || createUploadStore({ cwd })
  const metadata = new Map()
  const warnings = new Set()
  const cleanup = setInterval(() => { try { uploads.sweep() } catch {} }, 60000)
  cleanup.unref()
  function rememberChoice(threadId, choice) {
    try { modelControls.remember(threadId, choice) }
    catch { emit({ type: 'crossing/warning', threadId, message: '模型选择未能保存到磁盘，服务重启后请重新选择。' }) }
  }
  function threadView(result, history = false) {
    const meta = confirmedModel(result)
    metadata.set(result.thread.id, meta)
    const view = { ...publicThread(result.thread), ...meta }
    if (history) view.turns = (result.thread.turns || []).map(t => ({ id: t.id, status: t.status || null, items: (t.items || []).filter(i => ['userMessage', 'agentMessage'].includes(i.type)).map(i => i.type === 'userMessage' ? { id: i.id, type: i.type, content: (i.content || []).map(c => c.type === 'text' ? { type: 'text', text: c.text } : { type: 'text', text: '[图片附件]' }) } : { id: i.id, type: i.type, text: i.text }) }))
    return view
  }

  function status(state, extra = {}) { broadcast({ type: 'crossing/status', agent: 'codex', state, ...extra }) }
  function emit(event) { broadcast({ agent: 'codex', ...event }) }

  async function ensureOnline() {
    if (adapter.online) return
    status('connecting')
    try {
      await adapter.start()
      status('online')
      await publishRateLimits()
    } catch (error) {
      status('error', { error: clip(error.message, 300) })
      throw error
    }
  }

  async function publishRateLimits() {
    try {
      const usage = await adapter.rateLimits()
      emit({ type: 'crossing/usage', usage })
      return usage
    } catch (error) {
      const usage = rateLimitFallback()
      emit({ type: 'crossing/usage', usage: usage || { source: 'unavailable', primary: null, secondary: null }, error: usage ? '' : clip(error.message, 240) })
      return usage
    }
  }

  function clearApproval(requestId, reject = false) {
    const entry = approvals.get(String(requestId))
    if (!entry) return false
    clearTimeout(entry.timer)
    approvals.delete(String(requestId))
    if (reject) adapter.rejectServerRequest(requestId)
    return true
  }

  function clearTurn(turnId) {
    if (activeTurn?.turnId !== turnId) return
    uploads.pin(activeTurn.attachments, false, activeTurn.attachmentOwner || activeTurn.clientId)
    activeTurn = null
    for (const [requestId, approval] of approvals) {
      if (approval.turnId === turnId) clearApproval(requestId, true)
    }
  }

  function assertClientTurn(clientId, data) {
    if (!activeTurn) throw new Error('当前没有活动任务')
    if (activeTurn.clientId !== clientId || activeTurn.threadId !== data.threadId || activeTurn.turnId !== data.turnId) {
      throw new Error('此操作不属于当前任务')
    }
  }

  adapter.on('online', () => status('online'))
  adapter.on('offline', ({ error, pendingRequestIds }) => {
    uploads.pin(activeTurn?.attachments, false, activeTurn?.attachmentOwner || activeTurn?.clientId)
    metadata.clear()
    sessions.clear()
    for (const requestId of pendingRequestIds || []) clearApproval(requestId)
    activeTurn = null
    startingTurn = null
    status('offline', { error: clip(error, 300) })
  })
  adapter.on('protocolError', (error) => status('error', { error: clip(error.message, 300) }))
  adapter.on('agentDelta', (params) => emit({ type: 'crossing/message/delta', ...params }))
  adapter.on('item', (event) => {
    // Raw userMessage items may contain localImage filesystem paths.
    const { item, ...publicEvent } = event
    emit({ type: 'crossing/item', ...publicEvent })
    if (event.summary?.type === 'contextCompaction') emit({ type: 'crossing/context-compaction', threadId: event.threadId, turnId: event.turnId, lifecycle: event.lifecycle })
  })
  adapter.on('turnCompleted', (params) => {
    emit({ type: 'crossing/turn/completed', threadId: params.threadId, turn: { id: params.turn?.id || params.turnId, status: params.turn?.status || null } })
    clearTurn(params.turn?.id || params.turnId)
  })
  adapter.on('rateLimits', (usage) => emit({ type: 'crossing/usage', usage }))
  adapter.on('notification', (message) => {
    if (message.method === 'warning') {
      const key = `${message.params?.threadId}:${message.params?.message}`
      if (!warnings.has(key)) {
        if (warnings.size > 100) warnings.clear()
        warnings.add(key)
        emit({ type: 'crossing/warning', threadId: message.params?.threadId, message: clip(message.params?.message, 500) })
      }
    }
    if (message.method === 'thread/settings/updated') {
      const p = message.params
      const meta = { model: p.threadSettings?.model || null, reasoningEffort: p.threadSettings?.effort ?? null }
      metadata.set(p.threadId, meta)
      emit({ type: 'crossing/model/confirmed', threadId: p.threadId, ...meta })
    }
    if (message.method === 'serverRequest/resolved') {
      clearApproval(message.params?.requestId)
      emit({ type: 'crossing/approval/resolved', ...message.params })
    }
  })
  adapter.on('serverRequest', (request) => {
    const result = approvalResult(request.method, 'deny')
    const view = approvalView(request)
    if (!result || !activeTurn || activeTurn.threadId !== view.threadId || activeTurn.turnId !== view.turnId) {
      adapter.rejectServerRequest(request.id, '渡口不接受此类授权请求')
      return
    }
    const timer = setTimeout(() => {
      if (!clearApproval(view.requestId)) return
      adapter.resolveServerRequest(view.requestId, approvalResult(request.method, 'deny'))
      emit({ type: 'crossing/approval/resolved', requestId: view.requestId, threadId: view.threadId, turnId: view.turnId, itemId: view.itemId, outcome: 'timed_out' })
    }, APPROVAL_TIMEOUT_MS)
    approvals.set(view.requestId, { ...view, clientId: activeTurn.clientId, method: request.method, timer })
    send(activeTurn.clientId, { type: 'crossing/approval/request', agent: 'codex', ...view, expiresAt: Date.now() + APPROVAL_TIMEOUT_MS })
  })

  async function perform(clientId, message) {
    check(clientId)
    const type = message?.type
    if (!OPERATIONS.has(type)) throw new Error('unauthorized')
    const request = (method, params) => { check(clientId); return adapter.request(method, params) }
    if (['crossing/model/apply', 'crossing/thread/read', 'crossing/thread/resume'].includes(type) && !allowedThreads.get(clientId)?.has(message.threadId)) throw new Error('unauthorized thread')
    await ensureOnline()
    check(clientId)
    if (type === 'crossing/model/list') {
      send(clientId, { type: 'crossing/models', requestId: message.requestId, models: await modelControls.list(true) })
      return
    }
    if (type === 'crossing/model/apply') {
      const threadId = String(message.threadId || '')
      if (!threadId || selecting.has(clientId) || sessions.get(clientId) !== threadId) throw new Error('会话尚未恢复，不能应用模型')
      if (activeTurn || startingTurn) throw new Error('请先停止当前任务再应用模型')
      const choice = await modelControls.validate(message)
      check(clientId)
      rememberChoice(threadId, choice)
      // thread/settings/update is experimental in Codex 0.153.4 and this
      // connection deliberately uses the stable API. Queue the stable
      // turn/start override instead; that request makes it sticky for this and
      // subsequent turns.
      send(clientId, { type: 'crossing/model/pending', requestId: message.requestId, threadId, model: choice.model, effort: choice.effort })
      return
    }
    if (type === 'crossing/thread/list') {
      const result = await request('thread/list', { cwd, limit: 80, sourceKinds: ['appServer', 'cli', 'vscode'], cursor: message.cursor || null })
      check(clientId)
      const permitted = allowedThreads.get(clientId) || new Set()
      for (const thread of result.data || []) permitted.add(thread.id)
      allowedThreads.set(clientId, permitted)
      send(clientId, { type: 'crossing/threads', threads: (result.data || []).map(publicThread).filter(Boolean), nextCursor: result.nextCursor || null })
      return
    }
    if (type === 'crossing/thread/start') {
      sessions.delete(clientId)
      const choice = message.model ? await modelControls.validate(message) : null
      const result = await request('thread/start', { cwd, sandbox: 'workspace-write', approvalPolicy: 'untrusted', approvalsReviewer: 'user', ...threadOverrides(choice) })
      if (!result.thread?.id) throw new Error('Codex 未返回会话编号')
      if (disconnectedClients.has(clientId)) return
      sessions.set(clientId, result.thread.id)
      allowedThreads.set(clientId, new Set([...(allowedThreads.get(clientId) || []), result.thread.id]))
      if (choice) rememberChoice(result.thread.id, choice)
      send(clientId, { type: 'crossing/thread', requestId: message.requestId, action: 'started', ready: true, thread: threadView(result), pendingModel: choice && (confirmedModel(result).model !== choice.model || confirmedModel(result).reasoningEffort !== choice.effort) ? choice : null })
      return
    }
    if (type === 'crossing/thread/read') {
      const result = await request('thread/read', { threadId: String(message.threadId || ''), includeTurns: true })
      send(clientId, { type: 'crossing/thread', requestId: message.requestId, action: 'read', ready: false, thread: threadView(result, true) })
      return
    }
    if (type === 'crossing/thread/resume') {
      sessions.delete(clientId)
      const requested = message.model ? message : null
      const choice = requested ? await modelControls.validate(requested) : null
      const result = await request('thread/resume', { threadId: String(message.threadId || ''), cwd, sandbox: 'workspace-write', approvalPolicy: 'untrusted', approvalsReviewer: 'user', excludeTurns: false })
      if (!result.thread?.id || result.thread.id !== message.threadId) throw new Error('Codex 返回的会话编号不匹配')
      if (disconnectedClients.has(clientId)) return
      sessions.set(clientId, result.thread.id)
      if (choice) rememberChoice(result.thread.id, choice)
      const remembered = choice || modelControls.remembered(result.thread.id)
      const confirmed = confirmedModel(result)
      const pendingModel = remembered && (confirmed.model !== remembered.model || confirmed.reasoningEffort !== remembered.effort) ? remembered : null
      send(clientId, { type: 'crossing/thread', requestId: message.requestId, action: 'resumed', ready: true, thread: threadView(result, true), pendingModel })
      return
    }
    if (type === 'crossing/usage/read') { await publishRateLimits(); return }
    if (type === 'crossing/turn/start') {
      if (activeTurn || startingTurn) throw new Error('已有 Codex 任务正在运行；请先停止或等待完成')
      const threadId = String(message.threadId || '')
      const text = String(message.text || '').trim()
      if (!threadId || (!text && !message.attachments?.length)) throw new Error('缺少会话或消息内容')
      if (selecting.has(clientId) || sessions.get(clientId) !== threadId) throw new Error('会话尚未恢复，请重新选择会话')
      // Defence in depth for stale/cached clients: /model is a local UI
      // command and must never enter Codex conversation history.
      if (localModelCommand(text)) {
        send(clientId, { type: 'crossing/model/open', threadId, models: await modelControls.list(true) })
        return
      }
      startingTurn = { clientId, threadId }
      let uploadOwner = null
      try {
        const saved = modelControls.remembered(threadId)
        const current = metadata.get(threadId)
        const desired = message.model ? message : saved || (current?.model ? { model: current.model, effort: current.reasoningEffort } : null)
        const choice = desired ? await modelControls.validate(desired) : null
        uploadOwner = message.attachments?.length ? attachmentOwner(clientId) : clientId
        if (message.attachments?.length && !uploadOwner) throw new Error('附件不可用，请重新添加')
        const attachmentInputs = uploads.inputs(message.attachments, !!choice?.inputModalities.includes('image'), uploadOwner)
        uploads.pin(message.attachments, true, uploadOwner)
        const result = await request('turn/start', {
          threadId, input: [...(text ? input(text) : []), ...attachmentInputs], clientUserMessageId: String(message.clientMessageId || ''),
          ...(choice ? { model: choice.model, effort: choice.effort } : {}),
          approvalPolicy: 'untrusted', approvalsReviewer: 'user',
          sandboxPolicy: { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false },
        })
        const turnId = result.turn?.id
        if (!turnId) throw new Error('Codex 未返回任务编号')
        activeTurn = { clientId, threadId, turnId, ...(message.attachments?.length ? { attachments: message.attachments, attachmentOwner: uploadOwner } : {}) }
        if (choice) rememberChoice(threadId, choice)
        if (disconnectedClients.has(clientId)) {
          await adapter.request('turn/interrupt', { threadId, turnId }).catch(() => {})
          activeTurn = null
          throw new Error('浏览器已断开，已停止该任务')
        }
        emit({ type: 'crossing/turn/started', threadId, turn: result.turn })
        // A turn response has no model field. Read the server's persisted thread
        // metadata instead of trusting the requested override or assistant prose.
        void request('thread/read', { threadId, includeTurns: false }).then(result => {
          if (result.thread?.id !== threadId) return
          const meta = confirmedModel(result)
          metadata.set(threadId, meta)
          emit({ type: 'crossing/model/confirmed', threadId, ...meta })
        }).catch(() => {})
      } finally {
        if (!activeTurn) uploads.pin(message.attachments, false, uploadOwner || clientId)
        startingTurn = null
      }
      return
    }
    if (type === 'crossing/turn/interrupt') {
      assertClientTurn(clientId, message)
      await request('turn/interrupt', { threadId: activeTurn.threadId, turnId: activeTurn.turnId })
      emit({ type: 'crossing/turn/interrupted', threadId: activeTurn.threadId, turnId: activeTurn.turnId })
      return
    }
    if (type === 'crossing/approval/respond') {
      const requestId = String(message.requestId || '')
      const approval = approvals.get(requestId)
      if (!approval || approval.clientId !== clientId || approval.threadId !== message.threadId || approval.turnId !== message.turnId || approval.itemId !== message.itemId) {
        throw new Error('授权请求已过期或不属于当前任务')
      }
      const choice = message.choice === 'allow' ? 'allow' : 'deny'
      clearApproval(requestId)
      adapter.resolveServerRequest(requestId, approvalResult(approval.method, choice))
      emit({ type: 'crossing/approval/resolved', requestId, threadId: approval.threadId, turnId: approval.turnId, itemId: approval.itemId, outcome: choice })
      return
    }
    throw new Error('未知渡口操作')
  }

  async function handle(clientId, message) {
    const changesSession = ['crossing/thread/start', 'crossing/thread/read', 'crossing/thread/resume'].includes(message?.type)
    if (!changesSession) return perform(clientId, message)
    if (selecting.has(clientId)) throw new Error('会话正在加载，请稍候')
    if (activeTurn || startingTurn) throw new Error('请先停止当前任务再切换会话')
    selecting.add(clientId)
    try { return await perform(clientId, message) }
    finally { selecting.delete(clientId) }
  }

  function disconnect(clientId) {
    sessions.delete(clientId)
    allowedThreads.delete(clientId)
    if (!retainUploadsOnDisconnect) uploads.revoke?.(attachmentOwner(clientId) || clientId)
    disconnectedClients.add(clientId)
    for (const [requestId, approval] of approvals) {
      if (approval.clientId !== clientId) continue
      clearApproval(requestId)
      adapter.resolveServerRequest(requestId, approvalResult(approval.method, 'deny'))
    }
    if (activeTurn?.clientId === clientId) {
      // 不杀掉 app-server；只中断属于已断开浏览器的实际 turn，避免迟到授权误用。
      adapter.request('turn/interrupt', { threadId: activeTurn.threadId, turnId: activeTurn.turnId }).catch(() => {})
    }
  }

  const canReceive = (id, message) => !message.threadId || (sessions.get(id) === message.threadId && (!activeTurn || activeTurn.clientId === id))
  return { handle, disconnect, adapter, uploads, canReceive, getActiveTurn: () => activeTurn, publishRateLimits }
}

module.exports = { createCrossingService, fallbackRateLimits, publicThread, approvalResult, diagnoseCrossingError }
