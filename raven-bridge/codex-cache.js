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
    // 0930：跟涟言那张卡一样给「命中率 · 几次请求 · 几次未命中」，不用她自己拿 token 数去算。
    // 统计范围是曜最近这一个会话（最新 rollout 的末尾 8MB）；命中率按 token 算，
    // 未命中＝这次请求读到的缓存不到输入的一半。
    let last = null, requests = 0, misses = 0, cachedSum = 0, inputSum = 0
    for (const line of lines) {
      if (!line.includes('"token_count"')) continue
      let cache
      try { cache = cacheFromEvent(JSON.parse(line), nowSeconds) } catch { continue }
      if (!cache) continue
      if (last && cache.updated_at === last.updated_at && cache.input_tokens === last.input_tokens) continue // 同一轮重复上报
      last = cache
      requests += 1
      cachedSum += cache.cached_input_tokens || 0
      inputSum += cache.input_tokens || 0
      if ((cache.input_tokens || 0) > 0 && (cache.cached_input_tokens || 0) < cache.input_tokens / 2) misses += 1
    }
    if (last) {
      return {
        ...last,
        requests,
        misses,
        hit_percent: inputSum > 0 ? Math.round((cachedSum / inputSum) * 100) : null,
      }
    }
    return { available: false, error: 'cache_fields_not_reported' }
  } catch {
    return { available: false, error: 'rollout_unreadable' }
  }
}

// 额度兜底（0929）：/var/lib/ai-usage/codex.json 由 codex 用户的 cron 取，那边的登录过期后一直是 http_401，
// 归巢额度卡片就显示曜「没数据」。可 ripple 下跑的 Codex（渡口/门铃）每轮都会在 rollout 的 token_count
// 事件里带上 rate_limits——官方给的百分比和重置时间，没有凭证。拿最近写过的 rollout 里最新那条。
function recentRollouts(directory, days = 3) {
  const found = []
  const walk = (dir, depth) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => b.name.localeCompare(a.name))
    let dirs = 0
    for (const entry of entries) {
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (dirs++ < days) walk(target, depth + 1) }
      else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) {
        try { found.push({ file: target, mtime: fs.statSync(target).mtimeMs }) } catch {}
      }
    }
  }
  walk(directory, 0)
  return found.sort((a, b) => b.mtime - a.mtime).map(x => x.file)
}

function rateLimitsFromEvent(event) {
  if (event?.type !== 'event_msg' || event?.payload?.type !== 'token_count') return null
  const r = event.payload.rate_limits
  if (!r || (!r.primary && !r.secondary)) return null
  const win = (w) => w ? { used_percent: Number(w.used_percent) || 0, reset_at: Number(w.resets_at) || 0, window_minutes: Number(w.window_minutes) || null } : null
  const updatedAt = Date.parse(event.timestamp) / 1000
  return {
    updated_at: Number.isFinite(updatedAt) ? updatedAt : null,
    plan: r.plan_type || '',
    limit_reached: !!r.rate_limit_reached_type,
    primary: win(r.primary),
    secondary: win(r.secondary),
  }
}

function readCodexRateLimits(sessionsDirectory = DEFAULT_SESSIONS) {
  for (const rollout of recentRollouts(sessionsDirectory).slice(0, 3)) {
    try {
      const stat = fs.statSync(rollout)
      const length = Math.min(stat.size, MAX_ROLLOUT_BYTES)
      const start = stat.size - length
      const fd = fs.openSync(rollout, 'r')
      const buffer = Buffer.alloc(length)
      try { fs.readSync(fd, buffer, 0, length, start) } finally { fs.closeSync(fd) }
      const lines = buffer.toString('utf8').split('\n')
      if (start > 0) lines.shift()
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (!lines[i].includes('"rate_limits"')) continue
        try { const r = rateLimitsFromEvent(JSON.parse(lines[i])); if (r) return r } catch {}
      }
    } catch {}
  }
  return null
}

module.exports = { cacheFromEvent, readCodexPromptCache, rateLimitsFromEvent, readCodexRateLimits }
