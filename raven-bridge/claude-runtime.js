const fs = require('fs')
const path = require('path')

const MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:[\]-]{0,159}$/
const SNAPSHOT_STALE_SECONDS = 15 * 60

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch { return null }
}

function validModel(value) {
  return typeof value === 'string' && MODEL_RE.test(value)
}

function contextSnapshot(file, now = Date.now()) {
  const data = readJson(file)
  if (!data || data.available === false) return null
  const pct = Number(data.context_used_percent)
  const contextWindow = Number(data.context_window_size)
  if (!Number.isFinite(pct) || pct < 0 || !Number.isFinite(contextWindow) || contextWindow <= 0) return null
  const updatedAt = Number(data.updated_at) || 0
  const ageSeconds = updatedAt ? Math.max(0, Math.round(now / 1000 - updatedAt)) : null
  return {
    pct: Math.min(100, pct),
    tokens: Math.round(contextWindow * Math.min(100, pct) / 100),
    contextWindow,
    model: validModel(data.model) ? data.model : '',
    ageSeconds,
    stale: ageSeconds === null || ageSeconds > SNAPSHOT_STALE_SECONDS,
    source: 'claude_statusline',
  }
}

function modelCatalog({ stateFile, settingsFile, usageFile }) {
  const found = new Map()
  const add = (id, label, source) => {
    if (!validModel(id)) return
    const existing = found.get(id)
    if (!existing || source === 'active' || source === 'configured') {
      found.set(id, { id, label: typeof label === 'string' && label.trim() ? label.trim() : id, source })
    }
  }

  // Claude Code exposes its standard tiers as stable aliases. The CLI resolves
  // these aliases to the newest model available to the signed-in account, so
  // they are a better source of truth than lastModelUsage (which is only
  // history and used to make Opus disappear from Raven's picker).
  add('default', '默认（Claude Code 推荐）', 'alias')
  add('opus', 'Opus（自动使用最新版本）', 'alias')
  add('sonnet', 'Sonnet（自动使用最新版本）', 'alias')
  add('haiku', 'Haiku（自动使用最新版本）', 'alias')

  // 1004 她想选「历史乌鸦」：这些是订阅还能跑的旧版本（当天用 claude -p --model 逐个探过；
  // Opus 4.1 会被自动改写成最新 Opus，所以不列）。以后下线了，切换会在终端里报错，从这里删掉就好
  for (const [id, label] of [
    ['claude-opus-5', 'Opus 5'], ['claude-opus-4-6', 'Opus 4.6'], ['claude-opus-4-5-20251101', 'Opus 4.5'],
    ['claude-sonnet-5', 'Sonnet 5'], ['claude-sonnet-4-6', 'Sonnet 4.6'], ['claude-sonnet-4-5-20250929', 'Sonnet 4.5'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
  ]) add(id, label, 'legacy')

  const usage = readJson(usageFile)
  add(usage?.model, usage?.model, 'active')

  const settings = readJson(settingsFile)
  add(settings?.model, settings?.model, 'configured')

  const state = readJson(stateFile)
  const rawCache = state?.additionalModelOptionsCache
  const cached = Array.isArray(rawCache) ? rawCache : (rawCache && typeof rawCache === 'object' ? Object.values(rawCache) : [])
  for (const entry of cached) {
    if (typeof entry === 'string') add(entry, entry, 'claude_cache')
    else if (entry && typeof entry === 'object') {
      const descriptionName = typeof entry.description === 'string' ? entry.description.split(' · ')[0] : ''
      add(entry.value || entry.model || entry.id, descriptionName || entry.label || entry.displayName || entry.name, 'claude_cache')
    }
  }

  const rank = { alias: 0, active: 1, configured: 2, claude_cache: 3, legacy: 4 }
  const legacyOrder = ['claude-opus-5', 'claude-opus-4-6', 'claude-opus-4-5-20251101', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001']
  const aliasRank = { default: 0, opus: 1, sonnet: 2, haiku: 3 }
  return [...found.values()].sort((a, b) => (rank[a.source] ?? 9) - (rank[b.source] ?? 9)
    || (aliasRank[a.id] ?? 9) - (aliasRank[b.id] ?? 9)
    || (legacyOrder.indexOf(a.id) - legacyOrder.indexOf(b.id))
    || a.label.localeCompare(b.label))
}

module.exports = { MODEL_RE, contextSnapshot, modelCatalog, validModel }
