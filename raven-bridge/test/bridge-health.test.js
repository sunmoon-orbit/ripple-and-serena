const test = require('node:test')
const assert = require('node:assert/strict')
const { performance } = require('node:perf_hooks')
const { spawnBounded, diagnostics, resetForTest } = require('../bounded-sync')
const { createEventLoopHealth } = require('../event-loop-health')
const { pingActiveSockets } = require('../ws-heartbeat')

test('a stuck synchronous probe is killed and repeated probes back off', () => {
  resetForTest()
  const started = performance.now()
  const first = spawnBounded('hung-fixture', process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 80, backoffMs: 5000 })
  const firstElapsed = performance.now() - started
  assert.equal(first.error?.code, 'ETIMEDOUT')
  assert.ok(firstElapsed < 1000, `probe took ${firstElapsed}ms`)
  const retryStarted = performance.now()
  const retry = spawnBounded('hung-fixture', process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 80, backoffMs: 5000 })
  assert.equal(retry.skipped, true)
  assert.ok(performance.now() - retryStarted < 50)
  assert.deepEqual(diagnostics().backedOffCommands, ['hung-fixture'])
  resetForTest()
})

test('event-loop lag monitor logs only sustained lag with a cooldown', () => {
  let tick = null
  let clock = 0
  const warnings = []
  const monitor = createEventLoopHealth({
    intervalMs: 100,
    warnMs: 50,
    warnSamples: 3,
    logCooldownMs: 1000,
    now: () => clock,
    logger: message => warnings.push(message),
    setInterval: callback => { tick = callback; return { unref() {} } },
    clearInterval() {},
  })
  for (const at of [160, 320, 480]) { clock = at; tick() }
  assert.equal(warnings.length, 1)
  clock = 640; tick()
  assert.equal(warnings.length, 1)
  assert.deepEqual(monitor.snapshot(), { eventLoopLagMs: 60, eventLoopMaxLagMs: 60 })
  monitor.stop()
})

test('heartbeat covers isolated Crossing sockets without duplicate pings', () => {
  const socket = { readyState: 1, count: 0, ping() { this.count++ } }
  const closed = { readyState: 3, ping() { throw new Error('must not ping closed socket') } }
  const pinged = pingActiveSockets(new Set([socket]), new Map([['same', socket], ['closed', closed]]))
  assert.equal(pinged, 1)
  assert.equal(socket.count, 1)
})
