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
      add(entry.value || entry.model || entry.id, entry.label || entry.displayName || entry.name, 'claude_cache')
    }
  }
  for (const project of Object.values(state?.projects || {})) {
    if (!project || typeof project !== 'object' || !project.lastModelUsage || typeof project.lastModelUsage !== 'object') continue
    for (const id of Object.keys(project.lastModelUsage)) add(id, id, 'recent')
  }

  const rank = { active: 0, configured: 1, claude_cache: 2, recent: 3 }
  return [...found.values()].sort((a, b) => (rank[a.source] ?? 9) - (rank[b.source] ?? 9) || a.label.localeCompare(b.label))
}

module.exports = { MODEL_RE, contextSnapshot, modelCatalog, validModel }
