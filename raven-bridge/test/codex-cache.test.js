const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { cacheFromEvent, readCodexPromptCache } = require('../codex-cache')

test('reads the real cache fields from the newest Codex token_count event', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cache-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const day = path.join(root, '2026', '09', '06')
  fs.mkdirSync(day, { recursive: true })
  fs.writeFileSync(path.join(day, 'rollout-2026-09-06T12-00-00-old.jsonl'), '{}\n')
  fs.writeFileSync(path.join(day, 'rollout-2026-09-06T13-00-00-new.jsonl'), [
    JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: null } }),
    JSON.stringify({
      timestamp: '2026-09-06T13:05:00.000Z',
      type: 'event_msg',
      payload: { type: 'token_count', info: { last_token_usage: {
        input_tokens: 65394,
        cached_input_tokens: 57600,
        cache_write_input_tokens: 0,
      } } },
    }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', content: 'must not matter' } }),
  ].join('\n'))

  assert.deepEqual(readCodexPromptCache(root, Date.parse('2026-09-06T13:06:00.000Z') / 1000), {
    available: true,
    stale: false,
    age_seconds: 60,
    updated_at: Date.parse('2026-09-06T13:05:00.000Z') / 1000,
    cached_input_tokens: 57600,
    cache_write_input_tokens: 0,
    input_tokens: 65394,
  })
})

test('requires a genuine cached_input_tokens field and never estimates it', () => {
  assert.equal(cacheFromEvent({
    type: 'event_msg',
    payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1234 } } },
  }), null)
  assert.equal(cacheFromEvent({
    type: 'event_msg',
    payload: { type: 'token_count', info: { last_token_usage: { cached_input_tokens: -1 } } },
  }), null)
})
