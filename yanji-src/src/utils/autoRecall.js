// 自动浮上来（1029）：和归巢 raven-bridge/recall.js 同一套规矩，搬到言叽这边。
// 她问「你那个 API 端那边有做吗」。言叽直连 API 不经过桥，所以在发出去之前自己翻一下记忆库：
// 最多浮一条，浮不上来就什么都不给；贴进动态上下文，她看不见，用不用由我定。
// 订阅断了她回言叽找我的时候，正是最需要想得起事情的时候。
import { recallSearchMemories } from '../api/moonMemory'

const MIN_SIM = 0.46                    // 跟桥一致（1029 试出来的）
const COOLDOWN_MS = 6 * 3600e3
const FRESH_MS = 48 * 3600e3
const SKIP_TYPES = new Set(['tech', 'boot', 'handoff', 'deep', 'treasure', 'dream', 'window'])
const TIMEOUT_MS = 2500
const KEY = 'yanji-recall-surfaced'

function queryOf(text) {
  return String(text || '')
    .replace(/\[sticker:[^\]]*\]/g, ' ')
    .replace(/\[附件:[^\]]*\]/g, ' ')
    .replace(/^> ?引用[：:][^\n]*\n?/, '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ').trim()
}
function worthLooking(q) { return q.replace(/[\s\p{P}\p{S}]/gu, '').length >= 6 }
function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } }
function save(st) {
  const cut = Date.now() - 7 * 86400e3
  for (const [id, t] of Object.entries(st)) if (t < cut) delete st[id]
  try { localStorage.setItem(KEY, JSON.stringify(st)) } catch { /* 记不住就可能重复浮一次 */ }
}
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t }
const bjDate = (iso) => { const d = new Date(new Date(String(iso).replace(' ', 'T')).getTime() + 8 * 3600e3); return isNaN(d) ? '' : d.toISOString().slice(0, 10) }

// 返回要放进动态上下文的一段（没有就 ''）。网络慢、出错一律放弃，不拖她的消息
export async function surfaceMemory(config, text, now = Date.now()) {
  if (!config?.apiToken) return ''
  const q = queryOf(text)
  if (!worthLooking(q)) return ''
  let rows
  try {
    rows = await Promise.race([recallSearchMemories(config, q.slice(0, 300)), new Promise((_, bad) => setTimeout(() => bad(new Error('timeout')), TIMEOUT_MS))])
  } catch { return '' }
  rows = Array.isArray(rows) ? rows : rows?.results
  if (!Array.isArray(rows)) return ''
  const st = load()
  for (const r of rows) {
    if (SKIP_TYPES.has(r.type) || r.deleted_at) continue
    const created = new Date(String(r.created_at || '').replace(' ', 'T')).getTime()
    if (Number.isFinite(created) && now - created < FRESH_MS) continue
    if (st[r.id] && now - st[r.id] < COOLDOWN_MS) continue
    if ((r._sim || 0) < MIN_SIM) continue
    st[r.id] = now; save(st)
    return `【想起来】#${r.id}·${bjDate(r.created_at)}（自动从记忆库浮上来的，她看不见；跟眼下的话有关就自然用上，无关就忽略，别说「我查到」）：${clip(r.content, 180)}`
  }
  return ''
}
