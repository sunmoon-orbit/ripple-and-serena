const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { CodexAppServer, summarizeItem } = require('../codex-app-server')
const { createCrossingService } = require('../yanji-crossing')

function fakeChild(onRequest) {
  const child = new EventEmitter()
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.killed = false
  child.kill = () => { child.killed = true; child.emit('exit', 0, null) }
  let buf = ''
  child.stdin.on('data', (chunk) => {
    buf += chunk.toString('utf8')
    let index
    while ((index = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, index); buf = buf.slice(index + 1)
      if (line.trim()) onRequest(JSON.parse(line), child)
    }
  })
  return child
}

function reply(child, id, result) {
  child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

test('Codex App Server performs initialize handshake and maps stable lifecycle events', async () => {
  const sent = []
  const child = fakeChild((message, process) => {
    sent.push(message)
    if (message.method === 'initialize') reply(process, message.id, { userAgent: 'fake', codexHome: '/tmp', platformFamily: 'unix', platformOs: 'linux' })
    if (message.method === 'thread/list') reply(process, message.id, { data: [] })
  })
  const adapter = new CodexAppServer({ spawn: () => child, requestTimeoutMs: 100 })
  const deltas = []; const items = []; const requests = []
  adapter.on('agentDelta', (event) => deltas.push(event))
  adapter.on('item', (event) => items.push(event))
  adapter.on('serverRequest', (event) => requests.push(event))
  await adapter.start()
  assert.equal(sent[0].method, 'initialize')
  assert.deepEqual(sent[0].params.capabilities, { experimentalApi: false })
  assert.equal(sent[1].method, 'initialized')

  child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { threadId: 't1', turnId: 'u1', itemId: 'i1', delta: '你好' } })}\n`)
  child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'item/completed', params: { threadId: 't1', turnId: 'u1', completedAtMs: 1, item: { id: 'i2', type: 'commandExecution', status: 'completed', command: 'pwd', cwd: '/tmp', commandActions: [], aggregatedOutput: '/tmp', exitCode: 0 } } })}\n`)
  child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { threadId: 't1', turnId: 'u1', itemId: 'i2', startedAtMs: 1, command: 'pwd' } })}\n`)
  assert.equal(deltas[0].delta, '你好')
  assert.equal(items[0].summary.output, '/tmp')
  assert.equal(requests[0].id, 'approval-1')
  adapter.resolveServerRequest('approval-1', { decision: 'decline' })
  assert.deepEqual(sent.at(-1), { jsonrpc: '2.0', id: 'approval-1', result: { decision: 'decline' } })
})

test('tool summaries are bounded and redact obvious credentials', () => {
  const summary = summarizeItem({ id: 'x', type: 'commandExecution', status: 'completed', command: 'curl', cwd: '/tmp', commandActions: [], aggregatedOutput: 'Authorization: Bearer very-secret-value' })
  assert.match(summary.output, /\[已隐藏\]/)
  assert.equal(summary.output.includes('very-secret-value'), false)
})

class FakeAdapter extends EventEmitter {
  constructor() { super(); this.online = false; this.calls = []; this.resolved = [] }
  async start() { this.online = true; this.emit('online', {}) }
  async rateLimits() { return { source: 'app-server', primary: { usedPercent: 4 }, secondary: { usedPercent: 8 } } }
  async request(method, params) {
    this.calls.push({ method, params })
    if (method === 'turn/start') return { turn: { id: 'turn-1', status: 'inProgress' } }
    if (method === 'thread/list') return { data: [{ id: 'thread-1' }] }
    if (method === 'thread/resume') return { thread: { id: params.threadId, turns: [] } }
    return {}
  }
  resolveServerRequest(id, result) { this.resolved.push({ id: String(id), result }) }
  rejectServerRequest(id) { this.resolved.push({ id: String(id), rejected: true }) }
}

test('Crossing binds approvals to exact client/thread/turn/item and declines on disconnect', async () => {
  const adapter = new FakeAdapter()
  const sent = []
  const service = createCrossingService({ authorize: () => true, adapter, send: (client, event) => sent.push({ client, event }), broadcast: () => {}, rateLimitFallback: () => null })
  await service.handle('phone-a', { type: 'crossing/thread/list' })
  await service.handle('phone-a', { type: 'crossing/thread/resume', threadId: 'thread-1' })
  await service.handle('phone-a', { type: 'crossing/turn/start', threadId: 'thread-1', text: '检查一下', clientMessageId: 'm1' })
  adapter.emit('serverRequest', {
    id: 'request-1', method: 'item/commandExecution/requestApproval',
    params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', startedAtMs: 1, command: 'ls' },
  })
  assert.equal(sent.at(-1).client, 'phone-a')
  await assert.rejects(() => service.handle('phone-b', { type: 'crossing/approval/respond', requestId: 'request-1', threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', choice: 'allow' }), /不属于当前任务/)
  await service.handle('phone-a', { type: 'crossing/approval/respond', requestId: 'request-1', threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', choice: 'allow' })
  assert.deepEqual(adapter.resolved[0], { id: 'request-1', result: { decision: 'accept' } })
  adapter.emit('serverRequest', {
    id: 'request-2', method: 'item/fileChange/requestApproval',
    params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-2', startedAtMs: 2, reason: '写入文件' },
  })
  service.disconnect('phone-a')
  assert.deepEqual(adapter.resolved[1], { id: 'request-2', result: { decision: 'decline' } })
  assert.deepEqual(adapter.calls.at(-1), { method: 'turn/interrupt', params: { threadId: 'thread-1', turnId: 'turn-1' } })
})

test('Crossing reserves the only active turn before turn/start resolves', async () => {
  class DelayedAdapter extends FakeAdapter {
    constructor() { super(); this.online = true; this.resolveTurn = null }
    async request(method, params) {
      this.calls.push({ method, params })
      if (method === 'thread/list') return { data: [{ id: 'thread-a' }] }
      if (method === 'turn/start') return new Promise((resolve) => { this.resolveTurn = resolve })
      if (method === 'thread/resume') return { thread: { id: params.threadId } }
      return {}
    }
  }
  const adapter = new DelayedAdapter()
  const service = createCrossingService({ authorize: () => true, adapter, send: () => {}, broadcast: () => {}, rateLimitFallback: () => null })
  await service.handle('phone-a', { type: 'crossing/thread/list' })
  await service.handle('phone-a', { type: 'crossing/thread/resume', threadId: 'thread-a' })
  const first = service.handle('phone-a', { type: 'crossing/turn/start', threadId: 'thread-a', text: '第一条' })
  await new Promise((resolve) => setImmediate(resolve))
  await assert.rejects(() => service.handle('phone-b', { type: 'crossing/turn/start', threadId: 'thread-b', text: '第二条' }), /已有 Codex 任务/)
  adapter.resolveTurn({ turn: { id: 'turn-a' } })
  await first
  assert.deepEqual(service.getActiveTurn(), { clientId: 'phone-a', threadId: 'thread-a', turnId: 'turn-a', imageAllowed: false })
})
