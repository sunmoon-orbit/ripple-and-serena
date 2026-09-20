import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createSessionFlow } from '../src/components/Crossing/session-flow.mjs'
import adapterModule from '../../raven-bridge/codex-app-server.js'
import serviceModule from '../../raven-bridge/yanji-crossing.js'

function fixture() {
  const calls = [], wire = [], jobs = []
  const child = new EventEmitter()
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
  child.kill = () => { child.killed = true; child.emit('exit', 0) }
  const thread = (id) => ({ id, turns: [{ id: 'old-turn', status: 'completed', items: [{ id: 'old', type: 'agentMessage', text: '历史回复' }] }] })
  child.stdin.on('data', chunk => {
    for (const line of String(chunk).trim().split('\n')) {
      const msg = JSON.parse(line); calls.push(msg)
      if (!('id' in msg)) continue
      const result = msg.method === 'thread/start' ? { thread: thread('new-thread') }
        : msg.method === 'thread/list' ? { data: [{ id: 'history', preview: '历史会话' }], nextCursor: null }
        : ['thread/read', 'thread/resume'].includes(msg.method) ? { thread: thread(msg.params.threadId) }
        : msg.method === 'turn/start' ? { turn: { id: 'turn-1' } }
        : msg.method === 'turn/steer' ? { turnId: msg.params.expectedTurnId } : {}
      queueMicrotask(() => child.stdout.write(JSON.stringify({ id: msg.id, result }) + '\n'))
    }
  })
  const adapter = new adapterModule.CodexAppServer({ spawn: () => child })
  let client = 'phone-1'
  const flow = createSessionFlow(msg => {
    wire.push(msg)
    const sender = client
    jobs.push(new Promise(resolve => setImmediate(resolve)).then(() => service.handle(sender, JSON.parse(JSON.stringify(msg)))).catch(error => flow.receive({ type: 'crossing/error', requestId: msg.requestId, error: error.message })))
  })
  const events = []
  const deliver = msg => { events.push(msg); flow.receive(JSON.parse(JSON.stringify(msg))) }
  const service = serviceModule.createCrossingService({ authorize: () => true, adapter, send: (_, msg) => deliver(msg), broadcast: deliver })
  return { calls, wire, events, flow, adapter, service,
    notify(method, params) { child.stdout.write(JSON.stringify({ method, params }) + '\n') },
    reconnect() { service.disconnect(client); flow.disconnect(); client = 'phone-2'; flow.receive({ type: 'crossing/authenticated' }) },
    async drain() { while (jobs.length) await jobs.shift() },
  }
}

test('new thread auto-selects only after backend confirmation, list explicitly includes appServer and CLI', async () => {
  const f = fixture()
  f.flow.receive({ type: 'crossing/authenticated' }); await f.drain()
  assert.equal(f.flow.start('cannot send', 'm0'), false)
  f.flow.create()
  assert.equal(f.flow.state.phase, 'loading')
  assert.equal(f.flow.start('still cannot send', 'm0'), false)
  await f.drain()
  assert.equal(f.flow.state.phase, 'ready')
  assert.equal(f.flow.state.thread.id, 'new-thread')
  assert.deepEqual(f.calls.find(x => x.method === 'thread/list').params.sourceKinds, ['appServer', 'cli', 'vscode'])
  assert.equal(f.calls.some(x => x.method === 'turn/start'), false)
  f.adapter.stop()
})

test('history click reads then resumes, reconnect confirms again; streaming and interrupt use actual wire contract', async () => {
  const f = fixture()
  f.flow.receive({ type: 'crossing/authenticated' }); await f.drain()
  f.flow.select('history'); await f.drain()
  assert.deepEqual(f.calls.filter(x => ['thread/read', 'thread/resume'].includes(x.method)).map(x => x.method), ['thread/read', 'thread/resume'])
  assert.equal(f.flow.state.thread.turns[0].items[0].text, '历史回复')
  assert.equal(f.flow.state.thread.turns[0].status, 'completed', 'history exposes confirmed completion for TTS')
  f.reconnect()
  assert.equal(f.flow.start('not yet', 'm0'), false)
  await f.drain()
  assert.equal(f.flow.state.phase, 'ready')
  assert.equal(f.calls.filter(x => x.method === 'thread/resume').length, 2)
  assert.equal(f.flow.start('fixture only', 'm1'), true); await f.drain()
  assert.equal(f.calls.find(x => x.method === 'turn/start').params.threadId, 'history')
  assert.equal(f.flow.steer('turn-1', '补充要求', 'm2'), true); await f.drain()
  assert.deepEqual(f.calls.find(x => x.method === 'turn/steer').params, {
    threadId: 'history', expectedTurnId: 'turn-1', input: [{ type: 'text', text: '补充要求' }], clientUserMessageId: 'm2',
  })
  f.notify('item/agentMessage/delta', { threadId: 'history', turnId: 'turn-1', itemId: 'item-1', delta: 'fixture reply' })
  assert.equal(f.events.find(x => x.type === 'crossing/message/delta').delta, 'fixture reply')
  await f.service.handle('phone-2', { type: 'crossing/turn/interrupt', threadId: 'history', turnId: 'turn-1' })
  assert.deepEqual(f.calls.at(-1).params, { threadId: 'history', turnId: 'turn-1' })
  f.notify('turn/completed', { threadId: 'history', turn: { id: 'turn-1', status: 'interrupted', items: [{ type: 'userMessage', content: [{ type: 'localImage', path: '/private/fixture.png' }] }] } })
  const completed = f.events.find(x => x.type === 'crossing/turn/completed')
  assert.deepEqual(completed.turn, { id: 'turn-1', status: 'interrupted' })
  assert.equal(JSON.stringify(completed).includes('/private/'), false)
  assert.equal(f.service.getActiveTurn(), null)
  f.adapter.stop()
})

test('stale replies and failed resume cannot enable sending; backend rejects unconfirmed threads', async () => {
  const sent = []
  const flow = createSessionFlow(x => sent.push(x))
  flow.receive({ type: 'crossing/authenticated' }); flow.create()
  const requestId = sent.at(-1).requestId
  flow.receive({ type: 'crossing/thread', requestId: 'old', action: 'started', ready: true, thread: { id: 'wrong' } })
  assert.equal(flow.state.phase, 'loading')
  flow.receive({ type: 'crossing/error', requestId, error: 'fixture failure' })
  assert.equal(flow.state.phase, 'empty')
  assert.equal(flow.start('no', 'm'), false)
  const f = fixture()
  await assert.rejects(f.service.handle('unknown', { type: 'crossing/turn/start', threadId: 'history', text: 'no' }), /尚未恢复/)
  assert.equal(f.calls.some(x => x.method === 'turn/start'), false)
  f.adapter.stop()
})

test('App Server exit invalidates the confirmed session and rejects pending requests', async () => {
  const f = fixture()
  f.flow.receive({ type: 'crossing/authenticated' }); await f.drain()
  f.flow.create(); await f.drain()
  const pending = f.adapter.request('thread/list', {})
  f.adapter.stop()
  await assert.rejects(pending, /已退出|已停止/)
  assert.equal(f.flow.state.phase, 'empty')
  assert.equal(f.flow.start('must not send', 'm'), false)
  assert.equal(f.adapter.pending.size, 0)
})
