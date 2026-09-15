const test = require('node:test')
const assert = require('node:assert/strict')
const { captureGate, gateStillOpen } = require('../proactive-gates')
test('legacy schedulers require explicit canonical permission, not time awareness or string booleans', async () => {
  for (const value of [undefined, false, 'false', 'true', 1]) {
    assert.equal(await captureGate(async () => ({ timeAwareness: true, callsEnabled: value, revision: 0 }), 'call'), null)
  }
  assert.equal(await captureGate(async () => ({ messagesEnabled: true, revision: 3 }), 'message'), 3)
})
test('final gate rejects work queued before off/on, missing settings and switched-off messages', async () => {
  let state = { messagesEnabled: true, revision: 1 }
  const get = async () => state, epoch = await captureGate(get, 'message')
  assert.equal(await gateStillOpen(get, 'message', epoch), true)
  state = { messagesEnabled: false, callsEnabled: true, revision: 2 }
  assert.equal(await gateStillOpen(get, 'message', epoch), false)
  state = { messagesEnabled: true, revision: 3 }
  assert.equal(await gateStillOpen(get, 'message', epoch), false)
  assert.equal(await gateStillOpen(get, 'message', null), false)
})
