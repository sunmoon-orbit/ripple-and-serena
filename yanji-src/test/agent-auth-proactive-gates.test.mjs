import test from 'node:test'
import assert from 'node:assert/strict'
import { canAuthenticate, bindAgentSession, invalidateAgent, agentRevision, settingsRoute } from '../src/components/Crossing/authorization.mjs'
import { syncContactFields, contactAllowed, createSettingsWriter, createContactGuard, invalidateContacts } from '../src/utils/proactiveGates.mjs'
test('new browser and disabled/missing credentials remain locked; changes invalidate current session', () => {
  for (const config of [undefined, {}, { enabled: true }, { enabled: false, apiToken: 'fixture' }]) assert.equal(canAuthenticate(config), false)
  assert.equal(canAuthenticate({ enabled: true, apiToken: 'fixture' }), true)
  let locks = 0
  const before = agentRevision(), unbind = bindAgentSession(() => locks++)
  invalidateAgent(); invalidateAgent(); unbind()
  assert.equal(locks, 1); assert.equal(agentRevision(), before + 2)
  assert.deepEqual(settingsRoute(), { panel: 'settings', intent: 'moon-settings' })
})
test('independent contact toggles serialize the backend canonical plural field', () => {
  for (const timeAwareness of [false, true]) for (const longingPush of [false, true]) for (const proactiveCall of [false, true]) {
    const state = { timeAwareness, longingPush, proactiveCall }
    assert.equal(contactAllowed(state, 'message'), longingPush)
    assert.equal(contactAllowed(state, 'call'), proactiveCall)
    assert.deepEqual(syncContactFields(state), { timeAwareness, longingPush, proactiveCalls: proactiveCall })
  }
  assert.equal(contactAllowed({ longingPush: 'false' }, 'message'), false)
})
test('settings writes are ordered and queued stale enable is superseded by opt-out', async () => {
  const seen = [], send = createSettingsWriter(async value => { seen.push(value) })
  await Promise.all([send(true), send(false)])
  assert.deepEqual(seen, [false])
})
test('missed followups and final output require both local and current server permission', async () => {
  let config = { messagesEnabled: true, callsEnabled: true, revision: 3 }
  let state = { longingPush: true, proactiveCall: true }
  const guard = createContactGuard(async () => config, () => state)
  assert.equal(await guard.check(), true)
  config = { ...config, messagesEnabled: false, revision: 4 }
  assert.equal(await guard.check(), false)
  config = { ...config, messagesEnabled: true, revision: 5 }
  assert.equal(await guard.check(), false)
  const fresh = createContactGuard(async () => config, () => state)
  assert.equal(await fresh.check(), true)
  invalidateContacts()
  assert.equal(await fresh.check(), false)
  state = { longingPush: false, proactiveCall: true }
  assert.equal(await createContactGuard(async () => config, () => state).check(), false)
})
