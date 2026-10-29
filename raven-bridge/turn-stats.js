// 每一轮的账单 / 上下文还剩多少（1029 她发来别人家的面板：「详细的 token 输入输出……更直观」，不抄，参考）。
// 数据都在终端那个 CC 的会话记录里：每次调用模型都带 usage；工具调用和工具结果也是一行一行的。
// 跟 session-history 一样只从文件尾巴倒着读，不整个读进来。
const fs = require('fs')
const path = require('path')
const { sessionFile, lineSpans } = require('./session-history')

const RECALL_LOG = path.join(__dirname, 'recall-log.jsonl')
const MAX_LINE = 1.5 * 1024 * 1024

// 美元 / 百万 token。Opus 5.5 的 API 公开价（订阅不按这个扣，只是「如果走 API 会是多少」）
const PRICE = { input: 4, output: 20, cacheRead: 0.2, write1h: 8, write5m: 5 }

function readTail(nLines) {
  const file = sessionFile()
  if (!file) return []
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const spans = lineSpans(fd, size, nLines).reverse()   // 旧的在前
    const out = []
    for (const [a, b] of spans) {
      if (b - a > MAX_LINE) continue                       // 多半是图片，跳过
      const buf = Buffer.alloc(b - a)
      fs.readSync(fd, buf, 0, b - a, a)
      try { out.push(JSON.parse(buf.toString('utf8'))) } catch {}
    }
    return out
  } finally { fs.closeSync(fd) }
}

const ts = d => new Date(d.timestamp || 0).getTime()

// 她（或终端）真正说的一句话，不是工具结果、不是系统塞的
function isRealUser(d) {
  if (d.type !== 'user' || d.isMeta || d.isSidechain) return false
  const c = d.message?.content
  if (typeof c === 'string') return !c.startsWith('<local-command') && !c.startsWith('<command-')
  if (Array.isArray(c)) return !c.some(x => x.type === 'tool_result') && c.some(x => x.type === 'text')
  return false
}

function costOf(u) {
  const w = u.cache_creation || {}
  const w1h = w.ephemeral_1h_input_tokens ?? (u.cache_creation_input_tokens || 0)
  const w5m = w.ephemeral_5m_input_tokens ?? 0
  return ((u.input_tokens || 0) * PRICE.input + (u.output_tokens || 0) * PRICE.output
    + (u.cache_read_input_tokens || 0) * PRICE.cacheRead + w1h * PRICE.write1h + w5m * PRICE.write5m) / 1e6
}

const ctxOf = u => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
const windowOf = ctx => ctx > 200000 ? 1000000 : 200000
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s }
const flat = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.type === 'text' ? x.text : x.type === 'image' ? '〔图〕' : '').join('\n') : ''

function recallNear(startMs) {
  // 桥在把她这句送进来之前先翻的记忆，所以记录时间比这一轮开头早一点点
  try {
    const st = fs.statSync(RECALL_LOG)
    const fd = fs.openSync(RECALL_LOG, 'r')
    try {
      const spans = lineSpans(fd, st.size, 40)
      for (const [a, b] of spans) {
        const buf = Buffer.alloc(b - a); fs.readSync(fd, buf, 0, b - a, a)
        let e; try { e = JSON.parse(buf.toString('utf8')) } catch { continue }
        const t = new Date(e.at).getTime()
        if (t <= startMs + 2000 && t >= startMs - 20000) return e
        if (t < startMs - 20000) break
      }
    } finally { fs.closeSync(fd) }
  } catch {}
  return null
}

// atMs：我这条回复发出的时间。找它所在的那一轮，汇总这一轮的花费、工具和浮上来的记忆
function turnStats(atMs, lines = readTail(1500)) {
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (isRealUser(lines[i]) && ts(lines[i]) <= atMs + 1000) start = i
  }
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) if (isRealUser(lines[i])) { end = i; break }
  const seen = new Map()     // 同一次调用会拆成好几行（思考、正文、工具），usage 一样，按 message.id 去重
  const tools = [], results = new Map()
  for (let i = start + 1; i < end; i++) {
    const d = lines[i], m = d.message
    if (d.type === 'assistant' && m?.usage) seen.set(m.id || d.uuid, m.usage)
    if (d.type === 'assistant' && Array.isArray(m?.content)) {
      for (const b of m.content) if (b.type === 'tool_use') tools.push({ id: b.id, name: b.name, input: cut(JSON.stringify(b.input), 700) })
    }
    if (d.type === 'user' && Array.isArray(m?.content)) {
      for (const b of m.content) if (b.type === 'tool_result') results.set(b.tool_use_id, { text: cut(flat(b.content), 700), error: !!b.is_error })
    }
  }
  const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, calls: seen.size }
  let lastCtx = 0
  for (const u of seen.values()) {
    sum.input += u.input_tokens || 0
    sum.output += u.output_tokens || 0
    sum.cacheRead += u.cache_read_input_tokens || 0
    sum.cacheWrite += u.cache_creation_input_tokens || 0
    sum.cost += costOf(u)
    lastCtx = ctxOf(u)
  }
  const denom = sum.input + sum.cacheRead + sum.cacheWrite
  sum.hitRate = denom ? sum.cacheRead / denom : 0
  sum.cost = Math.round(sum.cost * 10000) / 10000
  const startMs = ts(lines[start])
  const rc = recallNear(startMs)
  return {
    startedAt: lines[start].timestamp,
    said: cut(flat(lines[start].message.content).replace(/〔想起来[\s\S]*?〕/g, '').replace(/^【[^】]*】/, '').replace(/　〔\d\d-\d\d \d\d:\d\d〕\s*$/, '').trim(), 120),
    usage: sum,
    context: { used: lastCtx, window: windowOf(lastCtx) },
    tools: tools.map(t => ({ ...t, result: results.get(t.id) || null })),
    recall: rc ? { pick: rc.pick || null, sim: rc.sim ?? null, snippet: rc.snippet || '', why: rc.why || (rc.err ? 'error' : null), top: rc.top || [] } : null,
  }
}

// 上下文现在多满：最后一次调用的输入总量；今天（北京时间）累计
function contextStats(lines = readTail(3000)) {
  let last = null, model = ''
  const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  const today = { cacheRead: 0, cacheWrite: 0, output: 0, cost: 0, calls: 0 }
  const seen = new Set()
  for (const d of lines) {
    const m = d.message
    if (d.type !== 'assistant' || !m?.usage) continue
    last = { u: m.usage, at: d.timestamp }
    model = m.model || model
    const key = m.id || d.uuid
    if (seen.has(key)) continue
    seen.add(key)
    if (new Date(ts(d) + 8 * 3600e3).toISOString().slice(0, 10) !== day) continue
    today.cacheRead += m.usage.cache_read_input_tokens || 0
    today.cacheWrite += m.usage.cache_creation_input_tokens || 0
    today.output += m.usage.output_tokens || 0
    today.cost += costOf(m.usage)
    today.calls++
  }
  if (!last) return null
  const used = ctxOf(last.u)
  today.cost = Math.round(today.cost * 100) / 100
  return { used, window: windowOf(used), at: last.at, model, today }
}

module.exports = { turnStats, contextStats, isRealUser, costOf, PRICE }
