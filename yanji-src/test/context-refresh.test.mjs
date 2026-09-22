import test from 'node:test'
import assert from 'node:assert/strict'
import { contextRefreshPlan, compactionBatches } from '../src/utils/contextRefresh.js'

const history = rounds => Array.from({ length: rounds * 2 }, (_, i) => ({ id: String(i), role: i % 2 ? 'assistant' : 'user', content: '一句话' }))
test('refresh threshold retains complete recent turns without changing original history', () => {
  const messages = history(40)
  const plan = contextRefreshPlan(messages)
  assert.equal(plan.due, true)
  assert.equal(plan.end, 68)
  assert.equal(messages.length, 80)
  const next = contextRefreshPlan(messages, { compactedThrough: '67' }, true)
  assert.equal(next.start, 68)
  assert.equal(next.due, false)
  assert.equal(contextRefreshPlan(messages, { compactedThrough: '67' }, false).start, 0)
})
test('deferral waits ten more rounds and survives persisted metrics', () => {
  const chat = { contextRefreshSnooze: { rounds: 40, tokens: 500 } }
  assert.equal(contextRefreshPlan(history(49), chat).due, false)
  assert.equal(contextRefreshPlan(history(50), chat).due, true)
})
test('large text triggers refresh and batching preserves every character', () => {
  const messages = history(20)
  messages[0].content = '长'.repeat(25000)
  assert.equal(contextRefreshPlan(messages).due, true)
  const batches = compactionBatches(messages)
  assert.equal(batches.flat().map(m => m.content).join(''), messages.map(m => m.content).join(''))
  assert.ok(batches.every(b => b.reduce((n, m) => n + m.content.length, 0) <= 10000))
})
