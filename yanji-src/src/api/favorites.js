// 收藏（1030）：长按/点星收下的消息，和归巢共用记忆库里同一本（moon /favorites）。
// 星星亮不亮要在每个气泡上查，所以钥匙表放在模块里，一处改了广播给所有气泡。
const keys = new Set()
const listeners = new Set()
let loadedFor = ''

async function favRequest(config, path = '', options = {}) {
  if (!config?.enabled || !config.apiToken) throw new Error('请先在 Hollow 连接记忆库')
  const response = await fetch(`${(config.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')}/favorites${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${config.apiToken}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
  })
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '记忆库钥匙无效' : `收藏请求失败（${response.status}）`)
  return response.json()
}

const emit = () => { for (const fn of listeners) fn() }
export const isFavorite = key => keys.has(String(key))
export function subscribeFavorites(fn) { listeners.add(fn); return () => listeners.delete(fn) }

export async function loadFavoriteKeys(config, force = false) {
  const tag = `${config?.baseUrl}|${config?.apiToken}`
  if (!force && loadedFor === tag) return
  loadedFor = tag
  try {
    const rows = await favRequest(config, '?source=yanji&keys=1')
    keys.clear(); for (const r of rows) keys.add(String(r.msg_key)); emit()
  } catch { loadedFor = '' }
}

export async function setFavorite(config, msg, on) {
  const key = String(msg.id)
  if (on) {
    await favRequest(config, '', { method: 'POST', body: JSON.stringify({
      source: 'yanji', msg_key: key, role: msg.role, text: msg.content || '',
      msg_at: msg.createdAt ? new Date(msg.createdAt).toISOString() : '',
    }) })
    keys.add(key)
  } else {
    await favRequest(config, `?source=yanji&key=${encodeURIComponent(key)}`, { method: 'DELETE' })
    keys.delete(key)
  }
  emit()
}

export const listFavorites = (config, before = '') => favRequest(config, `?limit=40${before ? `&before=${before}` : ''}`)
export const noteFavorite = (config, id, note) => favRequest(config, `/${id}`, { method: 'PATCH', body: JSON.stringify({ note }) })
export async function removeFavorite(config, row) {
  await favRequest(config, `/${row.id}`, { method: 'DELETE' })
  if (row.source === 'yanji') { keys.delete(String(row.msg_key)); emit() }
}
