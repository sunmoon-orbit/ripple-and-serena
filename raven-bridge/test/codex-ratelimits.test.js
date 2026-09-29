const test = require('node:test')
const assert = require('node:assert/strict')
const { rateLimitsFromEvent } = require('../codex-cache')

test('rollout token_count carries official Codex rate limits without credentials', () => {
  const r = rateLimitsFromEvent({ type: 'event_msg', timestamp: '2026-09-29T02:16:49.250Z', payload: { type: 'token_count', rate_limits: {
    primary: { used_percent: 26, window_minutes: 300, resets_at: 1790658442 },
    secondary: { used_percent: 38, window_minutes: 10080, resets_at: 1791054251 },
    plan_type: 'plus', rate_limit_reached_type: null } } })
  assert.equal(r.primary.used_percent, 26)
  assert.equal(r.secondary.reset_at, 1791054251)
  assert.equal(r.plan, 'plus')
  assert.equal(r.limit_reached, false)
  assert.equal(rateLimitsFromEvent({ type: 'event_msg', payload: { type: 'token_count' } }), null)
})
