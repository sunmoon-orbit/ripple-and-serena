const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizePromptCache } = require('../claude-cache')

test('normalizes official Claude Code prompt cache fields', () => {
  assert.deepEqual(normalizePromptCache({
    warm: true,
    caching_observed: true,
    ttl: '1h',
    expires_at: 1060,
    requests: 14,
    misses: 2,
    expected_rebuilds: 1,
    hit_ratio: 0.914,
    cache_write_tokens: 352000,
    last_miss_at: 900,
    last_miss_cause: { causes: ['tools_changed'] },
  }, 1000), {
    warm: true,
    caching_observed: true,
    ttl: '1h',
    expires_at: 1060,
    expires_after_seconds: 60,
    requests: 14,
    misses: 2,
    expected_rebuilds: 1,
    hit_percent: 91,
    cache_write_tokens: 352000,
    last_miss_at: 900,
    last_miss_causes: ['tools_changed'],
  })
})

test('handles missing, cold and malformed cache data safely', () => {
  assert.equal(normalizePromptCache(null), null)
  assert.deepEqual(normalizePromptCache({ warm: false, caching_observed: false, hit_ratio: 8, requests: -1 }, 1000), {
    warm: false,
    caching_observed: false,
    ttl: null,
    expires_at: null,
    expires_after_seconds: null,
    requests: null,
    misses: null,
    expected_rebuilds: null,
    hit_percent: 100,
    cache_write_tokens: null,
    last_miss_at: null,
    last_miss_causes: [],
  })
})
