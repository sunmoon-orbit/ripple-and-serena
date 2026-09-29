const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const { createRoundtable, extractAgentText } = require('../roundtable')

function fixture() {
  const broadcasts = []
  const posts = []
  const states = new Map()
  const messages = [{ id: 'm1', from: 'aying', to: ['lianyan'], text: '你好', attachments: [], replyTo: null, rootId: 'm1', aiWakeNo: 0, mentions: [], ts: new Date().toISOString() }]
  const deliveries = [{ id: 1, status: 'leased', message: messages[0] }]
  const crossing = {
    diagnostics: () => ({ childState: 'online', activeTurn: false, startingTurn: false, pendingApprovals: 0, activeOwner: null, orphaned: false }),
    startInternalTurn: async () => ({ threadId: 'thread-1', turnId: 'turn-1' }),
    respondInternalApproval: data => ({ requestId: data.requestId, outcome: data.choice }),
  }
  const moonGet = async path => {
    if (path.startsWith('/roundtable/counts')) return { lianyan: { pending: deliveries.length }, yao: {} }
    if (path.startsWith('/roundtable/messages')) return { messages, nextAfter: 'm1' }
    if (path.startsWith('/roundtable/deliveries?')) return { deliveries: [] }
    if (path.startsWith('/roundtable/state/')) return { value: states.get(path.split('/').pop()) || null }
    throw new Error(path)
  }
  const moonPost = async (path, body, method) => {
    posts.push({ path, body, method })
    if (path === '/roundtable/messages') return { status: 201, data: { created: true, messages } }
    if (path === '/roundtable/deliveries/claim') return { status: 200, data: { delivery: body.target === 'lianyan' ? deliveries.shift() || null : null } }
    if (path.startsWith('/roundtable/deliveries/')) return { status: 200, data: { delivery: { id: 1, status: body.status } } }
    if (path.startsWith('/roundtable/state/')) {
      states.set(path.split('/').pop(), body.value)
      return { status: 200, data: { value: body.value } }
    }
    return { status: 200, data: { ok: true } }
  }
  const service = createRoundtable({ moonGet, moonPost, crossing, broadcast: x => broadcasts.push(x), tmuxSend: () => true, ccBusy: () => false, ccOnline: () => true, disableTimer: true, logger: { error() {} } })
  return { service, broadcasts, posts, messages, states }
}

async function http(service, method, pathname, body) {
  const req = new EventEmitter()
  req.method = method
  req.destroy = () => {}
  const response = new Promise(resolve => {
    const res = {
      status: 0,
      writeHead(status) { this.status = status },
      end(value) { resolve({ status: this.status, body: JSON.parse(value || '{}') }) },
    }
    const pending = service.handleHttp(req, res, new URL('http://local' + pathname))
    queueMicrotask(() => {
      if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
      req.emit('end')
    })
    void pending
  })
  return response
}

test('agent text extraction accepts current app-server shapes', () => {
  assert.equal(extractAgentText({ type: 'agentMessage', text: '正文' }), '正文')
  assert.equal(extractAgentText({ type: 'agentMessage', content: [{ type: 'text', text: '分段' }] }), '分段')
})

test('WS sender gets accepted before the message broadcast', async () => {
  const { service, broadcasts } = fixture()
  const sent = []
  await service.handleWs({ send: value => sent.push(JSON.parse(value)) }, { type: 'roundtable/send', cid: 'c1', text: '你好' })
  assert.equal(sent[0].type, 'roundtable/accepted')
  assert.equal(broadcasts[0].type, 'roundtable/message')
})

test('scheduler sends Claude the short reply instruction and marks submitted', async () => {
  const { service, posts } = fixture()
  await service.tick()
  assert.equal(posts.some(entry => entry.path === '/roundtable/deliveries/1' && entry.body.status === 'submitted'), true)
})

test('roundtable avatars persist safe upload URLs and broadcast updates', async () => {
  const { service, broadcasts } = fixture()
  const saved = await http(service, 'PUT', '/raven/roundtable/avatars', {
    person: 'aying', url: '/raven/uploads/1700000000_%E9%98%BF%E9%A2%96.webp',
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.avatars.aying, '/raven/uploads/1700000000_%E9%98%BF%E9%A2%96.webp')
  assert.equal(broadcasts.at(-1).type, 'roundtable/avatars')

  const loaded = await http(service, 'GET', '/raven/roundtable/avatars')
  assert.deepEqual(loaded.body.avatars, saved.body.avatars)

  const rejected = await http(service, 'PUT', '/raven/roundtable/avatars', {
    person: 'yao', url: 'https://example.com/tracker.png',
  })
  assert.equal(rejected.status, 400)
  assert.equal(rejected.body.error, 'invalid_avatar_url')
})
