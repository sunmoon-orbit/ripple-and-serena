'use strict'

function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function nonNegativeInt(value) {
  const number = finite(value)
  return number !== null && number >= 0 ? Math.round(number) : null
}

function normalizePromptCache(value, nowSeconds = Date.now() / 1000) {
  if (!value || typeof value !== 'object') return null

  const hitRatio = finite(value.hit_ratio)
  const expiresAt = finite(value.expires_at)
  const causes = Array.isArray(value.last_miss_cause?.causes)
    ? value.last_miss_cause.causes.filter(cause => typeof cause === 'string').slice(0, 4)
    : []

  return {
    warm: value.warm === true,
    caching_observed: value.caching_observed === true,
    ttl: value.ttl === '5m' || value.ttl === '1h' ? value.ttl : null,
    expires_at: expiresAt,
    expires_after_seconds: expiresAt === null ? null : Math.max(0, Math.round(expiresAt - nowSeconds)),
    requests: nonNegativeInt(value.requests),
    misses: nonNegativeInt(value.misses),
    expected_rebuilds: nonNegativeInt(value.expected_rebuilds),
    hit_percent: hitRatio === null ? null : Math.round(Math.max(0, Math.min(1, hitRatio)) * 100),
    cache_write_tokens: nonNegativeInt(value.cache_write_tokens),
    last_miss_at: finite(value.last_miss_at),
    last_miss_causes: causes,
  }
}

module.exports = { normalizePromptCache }
