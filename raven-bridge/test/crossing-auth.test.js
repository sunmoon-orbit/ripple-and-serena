const test = require('node:test')
const assert = require('node:assert/strict')
const { createAgentSessions } = require('../crossing-auth')
const { OPERATIONS } = require('../crossing-auth')
const { createCrossingService } = require('../yanji-crossing')
const { EventEmitter } = require('node:events')
const { createUploadStore } = require('../crossing-uploads')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { validateToolRequest } = require('../crossing-tool-http')
const { handleUpload } = require('../crossing-upload-http')
const { verifyMemoryToken } = require('../crossing-memory-auth')

function fixture() {
  let token = 'fixture-only-credential', time = 100
  const revoked = []
  const sessions = createAgentSessions({ getToken: () => token, now: () => time, ttl: 50, onRevoke: r => revoked.push(r.id) })
  const ws = { readyState: 1 }
  return { sessions, ws, revoked, token, rotate: () => { token = 'rotated-fixture' }, expire: () => { time += 50 } }
}
test('missing, invalid and disabled credentials cannot open Agent sessions', () => {
  const { sessions, ws, token } = fixture()
  for (const value of ['', null, 'wrong']) assert.equal(sessions.open(ws, value, true), null)
  assert.equal(sessions.open(ws, token, false), null)
  assert.equal(sessions.open(ws, token, 'true'), null)
})
test('memory verification uses protected endpoint/header, rejects errors and never reads response bodies', async () => {
  for (const statusCode of [200, 401, 403, 500]) {
    let options, drained = false
    const transport = { get(input, reply) {
      options = input
      reply({ statusCode, resume() { drained = true } })
      const request = new EventEmitter(); request.setTimeout = () => request
      return request
    } }
    assert.equal(await verifyMemoryToken('fixture-only', transport), statusCode === 200)
    assert.equal(options.path, '/emotion/contact')
    assert.equal(options.path.includes('fixture-only'), false)
    assert.equal(options.headers.Authorization, 'Bearer fixture-only')
    assert.equal(drained, true)
  }
  assert.equal(await verifyMemoryToken('fixture', { get() { throw new Error('fixture') } }), false)
})
test('capabilities are independent, contain no raw token and require a live socket', () => {
  const { sessions, ws, token } = fixture()
  const a = sessions.open(ws, token, true)
  const b = sessions.open({ readyState: 1 }, token, true)
  const request = capability => ({ headers: { authorization: `Bearer ${capability}` } })
  assert.notEqual(a.capability, b.capability)
  assert.equal(JSON.stringify(a).includes(token), false)
  assert.equal(sessions.fromRequest(request(token)), null)
  assert.equal(sessions.fromRequest(request(a.capability)).id, a.id)
  ws.readyState = 3
  assert.equal(sessions.fromRequest(request(a.capability)), null)
  assert.ok(sessions.get(b.id))
})
test('expiry, logout and credential rotation invalidate capabilities', () => {
  for (const action of ['expire', 'rotate', 'logout']) {
    const f = fixture(), a = f.sessions.open(f.ws, f.token, true)
    if (action === 'logout') f.sessions.revoke(a.id)
    else f[action]()
    f.sessions.sweep()
    assert.equal(f.sessions.get(a.id), null)
    assert.deepEqual(f.revoked, [a.id])
  }
})
test('every Crossing operation fails before App Server startup when not authenticated', async () => {
  const adapter = new EventEmitter()
  let calls = 0
  adapter.start = () => { calls++; throw new Error('must not start') }
  adapter.request = () => { calls++; throw new Error('must not request') }
  const service = createCrossingService({ adapter })
  for (const type of [...OPERATIONS, 'crossing/unknown']) {
    await assert.rejects(service.handle('unauthenticated', { type }), /unauthorized/)
  }
  assert.equal(calls, 0)
})
test('attachment IDs cannot transfer between connections or survive session revocation', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-attachment-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const store = createUploadStore({ cwd })
  const file = { name: 'fixture.txt', mime: 'text/plain', data: Buffer.from('fixture').toString('base64') }
  assert.throws(() => store.put(file), /unauthorized/)
  const attachment = store.put(file, 'socket-a')
  assert.equal(store.inputs([attachment], false, 'socket-a')[0].type, 'text')
  assert.throws(() => store.inputs([attachment], false, 'socket-b'), /不可用/)
  store.revoke('socket-a')
  assert.throws(() => store.inputs([attachment], false, 'socket-a'), /不可用/)
})
test('scoped tool proxy cannot become a generic model, config or credential proxy', () => {
  for (const path of ['/tts', '/llm', '/proactive/run', '/idle/../llm', '/idle/%2e%2e/llm', 'https://example.invalid/vitals', '/vitals?token=fixture']) {
    assert.throws(() => validateToolRequest({ path }))
  }
  assert.throws(() => validateToolRequest({ path: '/idle/config', method: 'PUT' }))
  assert.equal(validateToolRequest({ path: '/games/1', method: 'PATCH', body: { name: 'fixture' } }).path, '/games/1')
})
test('HTTP auth is checked before tools/TTS and again before returning their result', async () => {
  let authorized = false, invoked = 0, finish
  function run(body) {
    return new Promise(resolve => {
      const req = new EventEmitter(); req.headers = { 'content-type': 'application/json' }; req.resume = () => {}
      const res = { writeHead(code) { this.code = code }, end(value) { resolve({ code: this.code, body: JSON.parse(value) }) } }
      handleUpload(req, res, {}, () => authorized ? { id: 'fixture-session' } : null, {
        tts: () => { invoked++; return new Promise(resolve => { finish = resolve }) },
        tool: async () => { invoked++; return { status: 200, data: [] } },
      })
      req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end')
    })
  }
  assert.equal((await run({ action: 'tts', text: 'fixture' })).code, 401)
  assert.equal((await run({ action: 'tool', path: '/vitals' })).code, 401)
  assert.equal(invoked, 0)
  authorized = true
  const pending = run({ action: 'tts', text: 'fixture' })
  authorized = false; finish({ audio: 'fixture-audio' })
  const result = await pending
  assert.equal(result.code, 401)
  assert.equal(JSON.stringify(result).includes('fixture-audio'), false)
})
test('unknown thread and cross-connection turn IDs cannot select or interrupt another task', async () => {
  const adapter = new EventEmitter(); adapter.online = true
  const calls = []
  adapter.request = async (method, params) => {
    calls.push(method)
    if (method === 'thread/start') return { thread: { id: 'owned' } }
    if (method === 'turn/start') return { turn: { id: 'turn-owned' } }
    return {}
  }
  const service = createCrossingService({ adapter, authorize: () => true })
  await service.handle('a', { type: 'crossing/thread/start' })
  await assert.rejects(service.handle('b', { type: 'crossing/thread/read', threadId: 'owned' }), /unauthorized/)
  await service.handle('a', { type: 'crossing/turn/start', threadId: 'owned', text: 'fixture' })
  await assert.rejects(service.handle('b', { type: 'crossing/turn/interrupt', threadId: 'owned', turnId: 'turn-owned' }), /不属于当前任务/)
  assert.equal(calls.includes('turn/interrupt'), false)
  service.disconnect('a')
  assert.equal(calls.includes('turn/interrupt'), true)
})
