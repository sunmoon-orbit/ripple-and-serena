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

// 1004 她说「官方给什么咱们就用什么」：订阅账号的 OAuth token 能直接问官方 /v1/models，
// 拿到的就是这个账号现在能看到的全部版本（新出的会自己出现，下线的会自己消失）。
// token 只在服务器上读、只发给 api.anthropic.com，不进前端也不进日志。拉不到就退回下面的手写名单。
const OFFICIAL_TTL_MS = 60 * 60 * 1000
const official = { at: 0, list: [], inflight: null }
async function refreshOfficialModels(credentialsFile, fetchImpl = globalThis.fetch) {
  const creds = readJson(credentialsFile)
  const token = creds?.claudeAiOauth?.accessToken
  if (!token || typeof fetchImpl !== 'function') return official.list
  const res = await fetchImpl('https://api.anthropic.com/v1/models?limit=100', {
    headers: { Authorization: `Bearer ${token}`, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'oauth-2025-04-20' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`models ${res.status}`)
  const data = await res.json()
  const list = (Array.isArray(data?.data) ? data.data : [])
    .filter(m => validModel(m?.id))
    .map(m => ({ id: m.id, label: String(m.display_name || m.id).replace(/^Claude\s+/, '') }))
  if (list.length) { official.list = list; official.at = Date.now() }
  return official.list
}
function officialModels(credentialsFile) {
  if (Date.now() - official.at > OFFICIAL_TTL_MS && !official.inflight) {
    official.inflight = refreshOfficialModels(credentialsFile)
      .catch(e => console.error('[models] 官方列表拉取失败，先用手写名单:', e.message))
      .finally(() => { official.inflight = null; if (!official.list.length) official.at = Date.now() - OFFICIAL_TTL_MS + 5 * 60 * 1000 })
  }
  return official.list
}

function modelCatalog({ stateFile, settingsFile, usageFile, officialList = [] }) {
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
  officialList.forEach(m => add(m.id, m.label, 'official'))
  if (!officialList.length) for (const [id, label] of [
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

  const rank = { alias: 0, active: 1, configured: 2, claude_cache: 3, official: 4, legacy: 4 }
  const officialOrder = officialList.map(m => m.id)
  const legacyOrder = ['claude-opus-5', 'claude-opus-4-6', 'claude-opus-4-5-20251101', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001']
  const aliasRank = { default: 0, opus: 1, sonnet: 2, haiku: 3 }
  return [...found.values()].sort((a, b) => (rank[a.source] ?? 9) - (rank[b.source] ?? 9)
    || (aliasRank[a.id] ?? 9) - (aliasRank[b.id] ?? 9)
    || (officialOrder.indexOf(a.id) - officialOrder.indexOf(b.id))
    || (legacyOrder.indexOf(a.id) - legacyOrder.indexOf(b.id))
    || a.label.localeCompare(b.label))
}

module.exports = { MODEL_RE, contextSnapshot, modelCatalog, validModel, officialModels, refreshOfficialModels }
