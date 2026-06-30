import { useStore } from './store'

function conn() {
  const s = useStore.getState()
  return { baseUrl: (s.baseUrl || '').replace(/\/$/, ''), token: s.apiToken }
}

async function req(path, options = {}) {
  const { baseUrl, token } = conn()
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(baseUrl + path, { ...options, headers })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`${res.status}: ${t.slice(0, 140)}`)
  }
  return res.status === 204 ? null : res.json()
}

function qs(params = {}) {
  const u = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null) u.set(k, String(v)) })
  const s = u.toString()
  return s ? '?' + s : ''
}

export const api = {
  list: (params = {}) => req('/memories/filter' + qs(params)),
  heatmap: (params = {}) => req('/memories/heatmap' + qs(params)),
  trash: () => req('/memories/trash?limit=300'),
  create: (body) => req('/memories', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => req(`/memories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  moveToTrash: (id) => req(`/memories/${id}/trash`, { method: 'POST', body: '{}' }),
  restore: (id) => req(`/memories/${id}/restore`, { method: 'POST', body: '{}' }),
  related: (id, k = 5) => req(`/memories/${id}/related?k=${k}`),
  semantic: (q, k = 20) => req(`/memories/semantic?q=${encodeURIComponent(q)}&k=${k}`),
  emotionHeatmap: (params = {}) => req('/memories/emotion-heatmap' + qs(params)),
  anniversaries: () => req('/anniversaries'),
  time: () => req('/context/time'),
  health: () => req('/health'),
  maintainHealth: () => req('/maintain/health'),
  importClaudeAI: (data) => req('/archive/import/claude-ai', { method: 'POST', body: JSON.stringify(data) }),
}
