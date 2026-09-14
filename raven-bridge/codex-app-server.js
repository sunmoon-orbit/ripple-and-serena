// Codex App Server adapter for 言叽·渡口.
//
// This module owns one long-lived JSON-RPC/JSONL stdio child.  It deliberately
// knows nothing about HTTP or WebSocket clients, so the transport boundary can
// be tested with a fake child process and the existing 归巢 channel stays intact.
const { EventEmitter } = require('events')
const { spawn: defaultSpawn } = require('child_process')

const DEFAULT_TIMEOUT_MS = 30000

function toError(value, fallback = 'Codex App Server 请求失败') {
  if (value instanceof Error) return value
  const message = value?.message || value?.error?.message || fallback
  return Object.assign(new Error(message), { code: value?.code })
}

function redactSensitive(value) {
  return String(value || '')
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)\S+/ig, '$1[已隐藏]')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|token|secret|password)\s*[:=]\s*)\S+/ig, '[已隐藏]')
}

function clip(value, limit = 1800) {
  const text = redactSensitive(value).trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function summarizeItem(item) {
  const base = { id: item?.id || '', type: item?.type || 'unknown', status: item?.status || 'working' }
  if (!item || typeof item !== 'object') return base
  if (item.type === 'commandExecution') {
    return { ...base, title: clip(item.command, 500) || '执行命令', cwd: item.cwd || '', exitCode: item.exitCode ?? null, output: clip(item.aggregatedOutput) }
  }
  if (item.type === 'fileChange') {
    const paths = (item.changes || []).map((change) => change.path || change.file || '').filter(Boolean)
    return { ...base, title: `修改 ${paths.length} 个文件`, paths: paths.slice(0, 12) }
  }
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
    return { ...base, title: item.tool || '调用工具', server: item.server || '', success: item.success ?? null, error: clip(item.error?.message || item.error || '') }
  }
  if (item.type === 'contextCompaction') return { ...base, title: '正在压缩上下文' }
  if (item.type === 'reasoning') return { ...base, title: '正在思考' }
  if (item.type === 'agentMessage') return { ...base, title: '正在回复' }
  return { ...base, title: item.type || '工作项' }
}

function normalizeRateLimits(payload) {
  const source = payload?.rateLimits || payload || {}
  const window = (entry) => entry ? {
    usedPercent: Number(entry.usedPercent) || 0,
    resetsAt: Number(entry.resetsAt) || null,
    windowDurationMins: Number(entry.windowDurationMins) || null,
  } : null
  return {
    source: 'app-server',
    planType: source.planType || '',
    limitReached: source.rateLimitReachedType || null,
    primary: window(source.primary),
    secondary: window(source.secondary),
  }
}

class CodexAppServer extends EventEmitter {
  constructor(options = {}) {
    super()
    this.command = options.command || 'codex'
    this.args = options.args || ['app-server', '--stdio']
    this.cwd = options.cwd || process.cwd()
    this.spawn = options.spawn || defaultSpawn
    this.requestTimeoutMs = options.requestTimeoutMs || DEFAULT_TIMEOUT_MS
    this.clientInfo = options.clientInfo || { name: 'yanji-crossing', title: '言叽·渡口', version: '1.0.0' }
    this.child = null
    this.ready = null
    this.nextId = 1
    this.pending = new Map()
    this.serverRequests = new Map()
    this.buffer = ''
    this.initialized = false
  }

  get online() { return !!this.child && this.initialized }

  async start() {
    if (this.ready) return this.ready
    this.child = this.spawn(this.command, this.args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => this._read(chunk))
    this.child.stderr.on('data', (chunk) => this.emit('stderr', clip(chunk, 600)))
    this.child.once('error', (error) => this._closed(toError(error)))
    this.child.once('exit', (code, signal) => this._closed(Object.assign(new Error(`Codex App Server 已退出（${signal || code || 'unknown'}）`), { code, signal })))

    this.ready = this.request('initialize', {
      clientInfo: this.clientInfo,
      capabilities: { experimentalApi: false },
    }).then(async (result) => {
      this.notify('initialized', {})
      this.initialized = true
      this.emit('online', result)
      return result
    }).catch((error) => {
      this._closed(error)
      throw error
    })
    return this.ready
  }

  stop() {
    if (this.child && !this.child.killed) this.child.kill()
    this._closed(new Error('Codex App Server 已停止'))
  }

  request(method, params, timeoutMs = this.requestTimeoutMs) {
    if (!this.child || this.child.killed) return Promise.reject(new Error('Codex App Server 未连接'))
    const id = this.nextId++
    const payload = { jsonrpc: '2.0', id, method }
    if (params !== undefined) payload.params = params
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} 请求超时`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer, method })
      this._write(payload)
    })
  }

  notify(method, params) {
    if (!this.child || this.child.killed) throw new Error('Codex App Server 未连接')
    const payload = { jsonrpc: '2.0', method }
    if (params !== undefined) payload.params = params
    this._write(payload)
  }

  async rateLimits() {
    const result = await this.request('account/rateLimits/read', null)
    return normalizeRateLimits(result)
  }

  resolveServerRequest(requestId, result) {
    const request = this.serverRequests.get(String(requestId))
    if (!request) throw new Error('授权请求已经失效')
    this.serverRequests.delete(String(requestId))
    this._write({ jsonrpc: '2.0', id: request.id, result })
  }

  rejectServerRequest(requestId, message = '该授权请求不再有效') {
    const request = this.serverRequests.get(String(requestId))
    if (!request) return false
    this.serverRequests.delete(String(requestId))
    this._write({ jsonrpc: '2.0', id: request.id, error: { code: -32001, message } })
    return true
  }

  _write(payload) {
    if (!this.child?.stdin?.writable) throw new Error('Codex App Server stdin 不可用')
    this.child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  _read(chunk) {
    this.buffer += chunk
    let newline
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      try { this._message(JSON.parse(line)) }
      catch { this.emit('protocolError', new Error('Codex App Server 返回了无效 JSON')) }
    }
  }

  _message(message) {
    if (Object.prototype.hasOwnProperty.call(message, 'id') && message.method) {
      const id = String(message.id)
      this.serverRequests.set(id, message)
      this.emit('serverRequest', message)
      return
    }
    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
      const entry = this.pending.get(message.id)
      if (!entry) return
      clearTimeout(entry.timer)
      this.pending.delete(message.id)
      if (message.error) {
        const error = toError(message.error, `${entry.method} 失败`)
        error.message = `${entry.method}: ${clip(error.message, 400)}`
        entry.reject(error)
      }
      else entry.resolve(message.result)
      return
    }
    if (!message.method) return
    this.emit('notification', message)
    if (message.method === 'item/started' || message.method === 'item/completed') {
      this.emit('item', { lifecycle: message.method.endsWith('started') ? 'started' : 'completed', ...message.params, summary: summarizeItem(message.params?.item) })
    }
    if (message.method === 'item/agentMessage/delta') this.emit('agentDelta', message.params)
    if (message.method === 'turn/completed') this.emit('turnCompleted', message.params)
    if (message.method === 'account/rateLimits/updated') this.emit('rateLimits', normalizeRateLimits(message.params))
  }

  _closed(error) {
    if (!this.child && !this.ready) return
    const pending = [...this.pending.values()]
    this.pending.clear()
    pending.forEach((entry) => { clearTimeout(entry.timer); entry.reject(error) })
    const serverRequests = [...this.serverRequests.keys()]
    this.serverRequests.clear()
    this.child = null
    this.ready = null
    this.initialized = false
    this.emit('offline', { error: error?.message || 'Codex App Server 已离线', pendingRequestIds: serverRequests })
  }
}

module.exports = { CodexAppServer, summarizeItem, normalizeRateLimits, clip }
