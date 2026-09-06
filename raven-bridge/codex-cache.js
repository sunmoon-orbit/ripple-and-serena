'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULT_SESSIONS = '/home/ripple/.codex/sessions'
const MAX_ROLLOUT_BYTES = 8 * 1024 * 1024
const STALE_SECONDS = 30 * 60

function newestRollout(directory) {
  let entries
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    return null
  }

  entries.sort((a, b) => b.name.localeCompare(a.name))
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = newestRollout(target)
      if (nested) return nested
    } else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) {
      return target
    }
  }
  return null
}

function nonNegativeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function cacheFromEvent(event, nowSeconds = Date.now() / 1000) {
  if (event?.type !== 'event_msg' || event?.payload?.type !== 'token_count') return null
  const usage = event.payload.info?.last_token_usage
  if (!usage || !Object.prototype.hasOwnProperty.call(usage, 'cached_input_tokens')) return null

  const cachedInputTokens = nonNegativeNumber(usage.cached_input_tokens)
  if (cachedInputTokens === null) return null
  const updatedAt = Date.parse(event.timestamp) / 1000
  const age = Number.isFinite(updatedAt) ? Math.max(0, Math.round(nowSeconds - updatedAt)) : null

  return {
    available: true,
    stale: age === null || age > STALE_SECONDS,
    age_seconds: age,
    updated_at: Number.isFinite(updatedAt) ? updatedAt : null,
    cached_input_tokens: cachedInputTokens,
    cache_write_input_tokens: nonNegativeNumber(usage.cache_write_input_tokens),
    input_tokens: nonNegativeNumber(usage.input_tokens),
  }
}

function readCodexPromptCache(sessionsDirectory = DEFAULT_SESSIONS, nowSeconds = Date.now() / 1000) {
  const rollout = newestRollout(sessionsDirectory)
  if (!rollout) return { available: false, error: 'rollout_missing' }

  try {
    const stat = fs.statSync(rollout)
    const length = Math.min(stat.size, MAX_ROLLOUT_BYTES)
    const start = stat.size - length
    const fd = fs.openSync(rollout, 'r')
    const buffer = Buffer.alloc(length)
    try {
      fs.readSync(fd, buffer, 0, length, start)
    } finally {
      fs.closeSync(fd)
    }

    const lines = buffer.toString('utf8').split('\n')
    if (start > 0) lines.shift() // the first line may be a partial JSON record
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (!lines[i].includes('"token_count"')) continue
      try {
        const cache = cacheFromEvent(JSON.parse(lines[i]), nowSeconds)
        if (cache) return cache
      } catch {}
    }
    return { available: false, error: 'cache_fields_not_reported' }
  } catch {
    return { available: false, error: 'rollout_unreadable' }
  }
}

module.exports = { cacheFromEvent, readCodexPromptCache }
