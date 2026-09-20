const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createCrossingService, diagnoseCrossingError } = require('../yanji-crossing')
const { createModelControls, confirmedModel } = require('../crossing-models')
const { createUploadStore, validateFile, safeImageURL, MAX_FILE, MAX_REMOTE_IMAGE } = require('../crossing-uploads')
const { handleUpload } = require('../crossing-upload-http')

const catalog = [
  { id: 'vision-id', model: 'vision-fixture', displayName: 'Fixture vision', hidden: false, inputModalities: ['text','image'], supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }], defaultReasoningEffort: 'low', isDefault: true },
  { id: 'text-id', model: 'text-fixture', displayName: 'Fixture text', hidden: false, inputModalities: ['text'], supportedReasoningEfforts: [{ reasoningEffort: 'medium' }], defaultReasoningEffort: 'medium', isDefault: false },
]
const png = { name: 'photo.png', mime: 'image/png', data: Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64') }
class Fixture extends EventEmitter {
  constructor() { super(); this.online = true; this.calls = []; this.thread = null }
  async rateLimits() { return {} }
  async request(method, params) {
    this.calls.push({ method, params })
    if (method === 'model/list') return params.cursor ? { data: [catalog[1]], nextCursor: null } : { data: [catalog[0], { ...catalog[1], id: 'hidden', hidden: true }], nextCursor: 'page2' }
    if (method === 'thread/list') return { data: this.thread ? [this.thread] : [] }
    if (method === 'thread/start' || method === 'thread/resume') {
      const model = params.model || this.thread?.model || 'vision-fixture'
      const reasoningEffort = params.config?.model_reasoning_effort || this.thread?.reasoningEffort || 'low'
      this.thread = { id: params.threadId || 'thread-fixture', model, reasoningEffort, turns: [] }
      return { model, reasoningEffort, thread: this.thread }
    }
    if (method === 'thread/read') return { thread: this.thread }
    if (method === 'turn/start') { this.thread.model = params.model; this.thread.reasoningEffort = params.effort; return { turn: { id: 'turn-fixture' } } }
    if (method === 'turn/steer') return { turnId: params.expectedTurnId }
    return {}
  }
}
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossing-controls-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir }

test('model/list exhausts pages, filters hidden and preserves all picker fields', async () => {
  const adapter = new Fixture(), controls = createModelControls(adapter)
  const models = await controls.list()
  assert.equal(models.length, 2)
  for (const key of ['id','model','displayName','inputModalities','supportedReasoningEfforts','defaultReasoningEffort','isDefault']) assert.deepEqual(models[0][key], catalog[0][key])
  assert.deepEqual(adapter.calls.map(x => x.params.cursor), [null, 'page2'])
  assert.ok(adapter.calls.every(x => x.params.includeHidden === false))
  await assert.rejects(controls.validate({ model: 'missing' }), /不可用/)
  await assert.rejects(controls.validate({ model: 'vision-fixture', effort: 'medium' }), /不支持/)
  assert.deepEqual(confirmedModel({ thread: {} }), { model: null, reasoningEffort: null })
})

test('Crossing failures retain actionable diagnostic categories', () => {
  assert.equal(diagnoseCrossingError(new Error('unauthorized thread'), 'crossing/model/apply').code, 'permission_or_auth')
  assert.equal(diagnoseCrossingError(new Error('thread not found'), 'crossing/model/apply').code, 'invalid_thread')
  assert.equal(diagnoseCrossingError(new Error('model unavailable'), 'crossing/model/apply').code, 'invalid_model')
  assert.equal(diagnoseCrossingError(new Error('unsupported reasoning effort'), 'crossing/model/apply').code, 'invalid_reasoning_effort')
  assert.equal(diagnoseCrossingError(new Error('JSON-RPC invalid params'), 'crossing/model/apply').code, 'app_server_protocol')
  assert.equal(diagnoseCrossingError(new Error('会话尚未恢复'), 'crossing/model/apply').code, 'socket_or_session_state')
  assert.equal(diagnoseCrossingError(new Error('附件不可用，请重新添加'), 'crossing/turn/start').code, 'invalid_attachment')
  assert.equal(diagnoseCrossingError(new Error('activeTurnNotSteerable'), 'crossing/turn/steer').code, 'turn_not_steerable')
})

test('image plus text survives a phone WebSocket reconnect for the same credential', async t => {
  const cwd = temp(t), adapter = new Fixture(), uploads = createUploadStore({ cwd })
  const credential = 'verified-credential-fingerprint'
  const image = uploads.put(png, credential)
  const service = createCrossingService({
    authorize: () => true,
    attachmentOwner: () => credential,
    retainUploadsOnDisconnect: true,
    adapter, uploads, cwd,
  })
  await service.handle('phone-before-picker', { type: 'crossing/thread/start', model: 'vision-id', effort: 'low' })
  service.disconnect('phone-before-picker')
  await service.handle('phone-after-picker', { type: 'crossing/thread/list' })
  await service.handle('phone-after-picker', { type: 'crossing/thread/resume', threadId: 'thread-fixture' })
  await service.handle('phone-after-picker', {
    type: 'crossing/turn/start', threadId: 'thread-fixture', text: '请看这张图片', attachments: [{ id: image.id }],
  })
  const turn = adapter.calls.filter(call => call.method === 'turn/start').at(-1)
  assert.equal(turn.params.input[0].type, 'text')
  assert.equal(turn.params.input[0].text, '请看这张图片')
  assert.equal(turn.params.input[1].type, 'localImage')
  assert.ok(turn.params.input[1].path.endsWith(image.id))
})

test('an active Crossing turn accepts same-turn supplemental text', async t => {
  const adapter = new Fixture(), sent = []
  const service = createCrossingService({ authorize: () => true, adapter, cwd: temp(t), send: (_client, event) => sent.push(event) })
  await service.handle('phone', { type: 'crossing/thread/start', model: 'vision-id', effort: 'low' })
  await service.handle('phone', { type: 'crossing/turn/start', threadId: 'thread-fixture', text: '开始处理' })
  await service.handle('phone', { type: 'crossing/turn/steer', threadId: 'thread-fixture', turnId: 'turn-fixture', text: '再补充这一点', clientMessageId: 'supplement-1' })
  const steer = adapter.calls.find(call => call.method === 'turn/steer')
  assert.deepEqual(steer.params, {
    threadId: 'thread-fixture', expectedTurnId: 'turn-fixture', input: [{ type: 'text', text: '再补充这一点' }], clientUserMessageId: 'supplement-1',
  })
  assert.deepEqual(sent.at(-1), { type: 'crossing/turn/steered', threadId: 'thread-fixture', turnId: 'turn-fixture', clientMessageId: 'supplement-1' })
})

test('model selection queues a stable turn/start override, confirms from thread/read, and survives reconnect', async t => {
  const cwd = temp(t), adapter = new Fixture(), events = []
  const stateFile = path.join(cwd, 'models.json')
  const service = createCrossingService({ authorize: () => true, adapter, cwd, modelStateFile: stateFile, send: (_, x) => events.push(x), broadcast: x => events.push(x) })
  await service.handle('phone', { type: 'crossing/thread/start', model: 'vision-id', effort: 'high', requestId: 'new' })
  const start = adapter.calls.find(x => x.method === 'thread/start')
  assert.equal(start.params.model, 'vision-fixture')
  assert.deepEqual(start.params.config, { model_reasoning_effort: 'high' })
  assert.equal(events.find(x => x.type === 'crossing/thread').thread.model, 'vision-fixture')
  await service.handle('phone', { type: 'crossing/model/apply', threadId: 'thread-fixture', model: 'text-fixture', effort: 'medium', requestId: 'apply' })
  assert.equal(adapter.calls.some(x => x.method === 'thread/settings/update'), false)
  assert.deepEqual(events.find(x => x.type === 'crossing/model/pending' && x.requestId === 'apply'), {
    type: 'crossing/model/pending', requestId: 'apply', threadId: 'thread-fixture', model: 'text-fixture', effort: 'medium',
  })
  assert.equal(adapter.thread.model, 'vision-fixture')
  service.disconnect('phone')
  const restarted = createCrossingService({ authorize: () => true, adapter, cwd, modelStateFile: stateFile, send: (_, x) => events.push(x), broadcast: x => events.push(x) })
  await restarted.handle('new-phone', { type: 'crossing/thread/list' })
  await restarted.handle('new-phone', { type: 'crossing/thread/resume', threadId: 'thread-fixture' })
  const resume = adapter.calls.filter(x => x.method === 'thread/resume').at(-1)
  assert.equal(resume.params.model, undefined)
  assert.equal(resume.params.config, undefined)
  assert.deepEqual(events.filter(x => x.type === 'crossing/thread').at(-1).pendingModel, { model: 'text-fixture', effort: 'medium' })
  await restarted.handle('new-phone', { type: 'crossing/turn/start', threadId: 'thread-fixture', text: 'fixture only' })
  const turn = adapter.calls.find(x => x.method === 'turn/start')
  assert.equal(turn.params.model, 'text-fixture'); assert.equal(turn.params.effort, 'medium')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events.filter(x => x.type === 'crossing/model/confirmed').at(-1), {
    agent: 'codex', type: 'crossing/model/confirmed', threadId: 'thread-fixture', model: 'text-fixture', reasoningEffort: 'medium',
  })
  adapter.emit('turnCompleted', { threadId: 'thread-fixture', turn: { id: 'turn-fixture' } })
  await restarted.handle('new-phone', { type: 'crossing/turn/start', threadId: 'thread-fixture', text: 'second fixture turn' })
  assert.equal(adapter.calls.filter(x => x.method === 'turn/start').at(-1).params.model, 'text-fixture')
  adapter.emit('notification', { method: 'warning', params: { threadId: 'thread-fixture', message: 'model switch fixture warning' } })
  adapter.emit('notification', { method: 'warning', params: { threadId: 'thread-fixture', message: 'model switch fixture warning' } })
  assert.equal(events.filter(x => x.type === 'crossing/warning').length, 2, 'one warning per live service instance')
  assert.equal(adapter.calls.some(x => x.method.startsWith('config/')), false)
  adapter.emit('item', { threadId: 'thread-fixture', item: { type: 'userMessage', content: [{ type: 'localImage', path: '/private/test.png' }] }, summary: { type: 'userMessage' } })
  assert.equal(JSON.stringify(events.filter(x => x.type === 'crossing/item')).includes('/private/'), false)
})

test('invalid model selection emits no pending/confirmation and preserves the confirmed thread', async t => {
  const adapter = new Fixture(), events = []
  const service = createCrossingService({ authorize: () => true, adapter, cwd: temp(t), send: (_, x) => events.push(x), broadcast: x => events.push(x) })
  await service.handle('phone', { type: 'crossing/thread/start', model: 'vision-id', effort: 'high' })
  const before = { ...adapter.thread }
  await assert.rejects(service.handle('phone', { type: 'crossing/model/apply', requestId: 'failed', threadId: 'thread-fixture', model: 'text-fixture', effort: 'ultra' }), /不支持/)
  assert.equal(events.some(x => x.type === 'crossing/model/confirmed' && x.requestId === 'failed'), false)
  assert.equal(events.some(x => x.type === 'crossing/model/pending' && x.requestId === 'failed'), false)
  assert.equal(adapter.thread.model, before.model)
  assert.equal(adapter.thread.reasoningEffort, before.reasoningEffort)
})

test('/model is intercepted by the bridge and never reaches turn/start', async t => {
  const adapter = new Fixture(), events = []
  const service = createCrossingService({ authorize: () => true, adapter, cwd: temp(t), send: (_, x) => events.push(x), broadcast: x => events.push(x) })
  await service.handle('phone', { type: 'crossing/thread/start' })
  await service.handle('phone', { type: 'crossing/turn/start', threadId: 'thread-fixture', text: '  /MODEL  ' })
  assert.equal(adapter.calls.some(x => x.method === 'turn/start'), false)
  assert.equal(events.at(-1).type, 'crossing/model/open')
})

test('uploads validate MIME, extension, traversal, byte limits and UTF-8; cleanup and inputs are real', t => {
  const cwd = temp(t); let now = Date.now()
  const store = createUploadStore({ cwd, now: () => now, ttl: 100 })
  // This fixture represents a verified socket, never a production default.
  const put = store.put.bind(store), inputs = store.inputs.bind(store)
  store.put = file => put(file, 'fixture-owner')
  store.inputs = (files, image) => inputs(files, image, 'fixture-owner')
  for (const name of ['../x.png', '/tmp/x.png', '..\\x.png']) assert.throws(() => store.put({ ...png, name }), /文件名/)
  assert.throws(() => store.put({ ...png, mime: 'text/plain' }), /MIME/)
  assert.throws(() => store.put({ ...png, data: Buffer.from('not a PNG').toString('base64') }), /MIME/)
  assert.throws(() => validateFile({ ...png, data: 'A'.repeat(Math.ceil(MAX_FILE / 3) * 4 + 4) }), /过大/)
  assert.throws(() => store.put({ name: 'file.pdf', mime: 'application/pdf', data: 'YQ==' }), /暂不支持/)
  assert.throws(() => store.put({ name: 'file.txt', mime: 'text/plain', data: Buffer.alloc(201 * 1024, 65).toString('base64') }), /200KB/)
  assert.throws(() => store.put({ name: 'file.txt', mime: 'text/plain', data: '/w==' }), /UTF-8/)
  const image = store.put(png)
  assert.equal('path' in image, false)
  assert.equal(JSON.stringify(image).includes(cwd), false)
  assert.throws(() => store.inputs([image], false), /不支持图片/)
  const local = store.inputs([image], true)[0]
  assert.equal(local.type, 'localImage'); assert.ok(fs.existsSync(local.path))
  const url = 'https://memory.ravenlove.cc/raven/stickers/kaixin.png'
  assert.deepEqual(store.inputs([{ url }], true), [{ type: 'image', url }])
  for (const url of ['http://127.0.0.1/x.png','https://memory.ravenlove.cc/raven/stickers/x.png?token=bad','file:///tmp/a.png']) assert.throws(() => safeImageURL(url))
  const text = store.put({ name: 'notes.md', mime: 'text/markdown', data: Buffer.from('fixture text').toString('base64') })
  assert.equal(store.inputs([text], false)[0].type, 'text')
  assert.equal(fs.readFileSync(path.join(cwd, '.crossing-uploads', text.id), 'utf8'), 'fixture text')
  assert.throws(() => store.inputs([{ id: '../photo.png' }], true), /过期/)
  store.pin([image], true, 'fixture-owner'); now += 1000; store.sweep()
  assert.ok(fs.existsSync(local.path)); assert.equal(fs.existsSync(path.join(cwd, '.crossing-uploads', text.id)), false)
  store.pin([image], false, 'fixture-owner'); store.sweep(); assert.equal(fs.existsSync(local.path), false)
})

test('trusted sticker URLs become bounded inline images for Codex App Server', async t => {
  const bytes = Buffer.from([137,80,78,71,13,10,26,10,0])
  const calls = []
  const store = createUploadStore({
    cwd: temp(t),
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return {
        ok: true,
        headers: { get: name => name === 'content-type' ? 'image/png' : name === 'content-length' ? String(bytes.length) : null },
        body: null,
        arrayBuffer: async () => bytes,
      }
    },
  })
  const url = 'https://memory.ravenlove.cc/raven/stickers/kaixin.png'
  const result = await store.resolveInputs([{ url }], true, 'fixture-owner')
  assert.deepEqual(result, [{ type: 'image', url: `data:image/png;base64,${bytes.toString('base64')}` }])
  assert.equal(calls[0].url, url)
  assert.equal(calls[0].options.redirect, 'error')

  const oversized = createUploadStore({
    cwd: temp(t),
    fetchImpl: async () => ({ ok: true, headers: { get: name => name === 'content-type' ? 'image/png' : String(MAX_REMOTE_IMAGE + 1) } }),
  })
  await assert.rejects(oversized.resolveInputs([{ url }], true, 'fixture-owner'), /过大/)
})

test('HTTP upload rejects oversized body and returns only opaque attachment metadata', t => {
  const store = createUploadStore({ cwd: temp(t) })
  function run(chunks, authed = true) {
    const req = new EventEmitter(); req.headers = { 'content-type': 'application/json' }; req.resume = () => {}
    const res = { writeHead(code) { this.code = code }, end(data) { this.body = JSON.parse(data) } }
    handleUpload(req, res, store, () => authed ? { id: 'fixture-owner' } : null)
    for (const chunk of chunks) req.emit('data', chunk)
    req.emit('end'); return res
  }
  assert.equal(run([Buffer.alloc(6 * 1024 * 1024 + 1)]).code, 413)
  assert.equal(run([Buffer.from(JSON.stringify(png))], false).code, 401)
  const result = run([Buffer.from(JSON.stringify(png))])
  assert.equal(result.code, 200); assert.equal(result.body.kind, 'image'); assert.equal(result.body.path, undefined)
})

test('HTTP upload uses a stable verified fingerprint when available', t => {
  let owner = ''
  const store = { put(_body, value) { owner = value; return { id: 'fixture' } } }
  const req = new EventEmitter(); req.headers = { 'content-type': 'application/json' }; req.resume = () => {}
  const res = { writeHead(code) { this.code = code }, end(data) { this.body = JSON.parse(data) } }
  handleUpload(req, res, store, () => ({ id: 'socket-id', fingerprint: 'credential-fingerprint' }))
  req.emit('data', Buffer.from(JSON.stringify(png))); req.emit('end')
  assert.equal(res.code, 200)
  assert.equal(owner, 'credential-fingerprint')
})
