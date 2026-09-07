const test = require('node:test')
const assert = require('node:assert/strict')
const { createAndcoWake, isDirected } = require('../andco-wake')

const servers = [{ id: 'andco', enabled: true, tools: [{ name: 'events', enabled: true }] }]
const config = { enabled: true, serverId: 'andco', wakeToolName: 'events', aiIdentityId: 'crow', roomId: 'room', chatId: 'chat', cooldownSeconds: 5, queueLimit: 1, dailyWakeLimit: 3, dailyCostLimitCents: 12, estimatedCostCents: 4 }
const tick = () => new Promise((resolve) => setImmediate(resolve))

function event(id, extra = {}) {
  return { id, roomId: 'room', targetAiId: 'crow', content: 'message', mentions: ['crow'], ...extra }
}

test('@, reply and platform-directed events are the only wake filters', () => {
  assert.equal(isDirected({ mentions: [{ id: 'crow' }] }, 'crow'), true)
  assert.equal(isDirected({ replyToAiId: 'crow' }, 'crow'), true)
  assert.equal(isDirected({ type: 'directed', targetAiId: 'crow' }, 'crow'), true)
  assert.equal(isDirected({ mentions: ['other'] }, 'crow'), false)
})

test('identity and room isolation reject out-of-scope events', () => {
  const state = {}
  const wake = createAndcoWake({ state, save() {}, deliver: async () => {} })
  wake.updateConfig(config, servers)
  assert.equal(wake.ingest(event('wrong-room', { roomId: 'elsewhere' }), servers).reason, 'scope_mismatch')
  assert.equal(wake.ingest(event('wrong-ai', { targetAiId: 'other' }), servers).reason, 'scope_mismatch')
  assert.equal(wake.ingest(event('ordinary', { mentions: [] }), servers).reason, 'not_directed')
})

test('stable IDs deduplicate and cooldown prevents repeated model work', () => {
  let now = Date.parse('2026-09-07T00:00:00Z')
  const wake = createAndcoWake({ state: {}, save() {}, deliver: async () => {}, now: () => now })
  wake.updateConfig(config, servers)
  assert.equal(wake.ingest(event('one'), servers).accepted, true)
  assert.equal(wake.ingest(event('one'), servers).reason, 'duplicate')
  assert.equal(wake.ingest(event('two'), servers).reason, 'cooldown')
  now += 6000
  assert.equal(wake.ingest(event('three'), servers).accepted, true)
})

test('queue bound, one-at-a-time delivery and daily cost protection', async () => {
  let now = Date.parse('2026-09-07T00:00:00Z')
  const releases = []
  let concurrent = 0
  let maxConcurrent = 0
  const wake = createAndcoWake({
    state: {}, save() {}, now: () => now,
    deliver: () => new Promise((resolve) => { concurrent += 1; maxConcurrent = Math.max(maxConcurrent, concurrent); releases.push(() => { concurrent -= 1; resolve() }) }),
  })
  wake.updateConfig({ ...config, cooldownSeconds: 5 }, servers)
  assert.equal(wake.ingest(event('one'), servers).accepted, true)
  now += 6000
  assert.equal(wake.ingest(event('two'), servers).accepted, true)
  now += 6000
  assert.equal(wake.ingest(event('three'), servers).reason, 'queue_full')
  releases.shift()(); await tick()
  assert.equal(maxConcurrent, 1)
  releases.shift()(); await tick()
  now += 6000
  assert.equal(wake.ingest(event('four'), servers).accepted, true)
  now += 6000
  assert.equal(wake.ingest(event('five'), servers).reason, 'daily_limit')
  releases.shift()(); await tick()
})

test('turning either switch off aborts and clears immediately', async () => {
  let aborted = false
  const state = {}
  const wake = createAndcoWake({
    state, save() {},
    deliver: (_event, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) }, { once: true })),
  })
  wake.updateConfig(config, servers)
  wake.ingest(event('one'), servers)
  wake.updateConfig({ enabled: false }, servers)
  await tick()
  assert.equal(aborted, true)
  assert.equal(state.queue.length, 0)
  assert.equal(wake.ingest(event('two'), servers).reason, 'disabled')
  wake.updateConfig(config, servers)
  assert.equal(wake.ingest(event('three'), [{ ...servers[0], tools: [{ name: 'events', enabled: false }] }]).reason, 'disabled')
})

test('delivery error stops the adapter without automatic reconnect', async () => {
  const state = {}
  let calls = 0
  const wake = createAndcoWake({ state, save() {}, deliver: async () => { calls += 1; throw new Error('Bearer secret-value rejected') } })
  wake.updateConfig(config, servers)
  wake.ingest(event('one'), servers)
  await tick()
  assert.equal(calls, 1)
  assert.equal(wake.status(servers).errorStopped, true)
  assert.equal(wake.ingest(event('two'), servers).reason, 'disabled')
  assert.equal(wake.status(servers).recent[0].error, '外部服务认证失败')
})
