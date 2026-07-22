import { useStore } from './store'

const DEFAULT_BASE = 'https://memory.ravenlove.cc'
function conn() {
  const s = useStore.getState()
  // 旧持久化里 baseUrl 可能是空（老版本遗留），空 baseUrl 会让 fetch 变成相对路径、
  // 在 GitHub Pages 上打到 sunmoon-orbit.github.io 返回 404 HTML。空或缺协议一律回退默认绝对地址。
  let b = (s.baseUrl || '').trim().replace(/\/$/, '')
  if (!b) b = DEFAULT_BASE
  else if (!/^https?:\/\//i.test(b)) b = 'https://' + b
  return { baseUrl: b, token: s.apiToken }
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
  graph: () => req('/memories/graph'),
  get: (id) => req(`/memories/${id}`),
  semantic: (q, k = 20) => req(`/memories/semantic?q=${encodeURIComponent(q)}&k=${k}`),
  emotionHeatmap: (params = {}) => req('/memories/emotion-heatmap' + qs(params)),
  anniversaries: () => req('/anniversaries'),
  time: () => req('/context/time'),
  health: () => req('/health'),
  maintainHealth: () => req('/maintain/health'),
  importClaudeAI: (data) => req('/archive/import/claude-ai', { method: 'POST', body: JSON.stringify(data) }),
  // 事件卷：提案审批 + 开卷（断供 CC 时阿颖也能自己处理）
  events: (status) => req('/events' + qs({ status })),
  eventDetail: (id) => req(`/events/${id}`),
  eventProposals: (status = 'pending') => req(`/events/proposals?status=${status}`),
  decideProposal: (id, action, punish_ids = []) =>
    req(`/events/proposals/${id}/decide`, { method: 'POST', body: JSON.stringify({ action, punish_ids }) }),
  createEvent: (body) => req('/events', { method: 'POST', body: JSON.stringify(body) }),
}
