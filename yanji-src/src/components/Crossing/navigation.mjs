// Only navigation identifiers live here, never credentials or model claims.
const KEY = 'yanji_navigation_v1'
export function normalizeNavigation(value = {}) {
  return {
    panel: ['roost', 'chat', 'crossing', 'memory', 'dream', 'moments', 'settings'].includes(value.panel) ? value.panel : 'roost',
    murmur: value.murmur === 'crossing' ? 'crossing' : 'chat',
    threadId: typeof value.threadId === 'string' ? value.threadId.slice(0, 200) : '',
    callFromCrossing: value.callFromCrossing === true,
    settingsSection: value.settingsSection === 'moon' ? 'moon' : '',
  }
}
export function readNavigation(storage = globalThis.localStorage) {
  try { return normalizeNavigation(JSON.parse(storage.getItem(KEY)) || {}) } catch { return normalizeNavigation() }
}
// 完整重载/冷启动时先落在 Roost，避免应用刚打开就把上次聊天露出来。
// Murmur 类型与 threadId 仍保留，用户主动点进聊天后可以接着上次的位置。
export function navigationForColdStart(value = {}) {
  return { ...normalizeNavigation(value), panel: 'roost', callFromCrossing: false, settingsSection: '' }
}
export function writeNavigation(value, storage = globalThis.localStorage) {
  const next = normalizeNavigation(value)
  try { storage.setItem(KEY, JSON.stringify(next)) } catch { /* Private/full storage: in-memory navigation still works. */ }
  return next
}
export function navigate(value, panel, intent) {
  const next = { ...normalizeNavigation(value) }
  next.panel = intent === 'bottom' && panel === 'chat' ? next.murmur : panel
  if (next.panel === 'crossing') next.murmur = 'crossing'
  if (intent === 'api-back') next.murmur = 'chat'
  next.callFromCrossing = intent === 'api-call'
  next.settingsSection = intent === 'moon-settings' ? 'moon' : ''
  return normalizeNavigation(next)
}
