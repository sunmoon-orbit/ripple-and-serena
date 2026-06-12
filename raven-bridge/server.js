const http = require('http')
const { WebSocketServer } = require('ws')
const { execFileSync, spawnSync } = require('child_process')
const os = require('os')
const fs = require('fs')
const path = require('path')

// token 从 moon-memory/.env 读取，不准硬编码（2026.6.11 公开仓库泄漏教训）
const MOON_TOKEN = (() => {
  const envText = fs.readFileSync('/home/ripple/moon-memory/.env', 'utf8')
  const m = envText.match(/^MOON_API_TOKEN=(.+)$/m)
  if (!m) { console.error('[fatal] MOON_API_TOKEN not found in .env'); process.exit(1) }
  return m[1].trim()
})()
const MOON_BASE = 'http://127.0.0.1:3210'

function moonGet(pathname) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port: 3210, path: pathname, headers: { Authorization: `Bearer ${MOON_TOKEN}` } }
    http.get(opts, res => {
      let buf = ''
      res.on('data', d => { buf += d })
      res.on('end', () => { try { resolve(JSON.parse(buf)) } catch { reject(new Error('parse')) } })
    }).on('error', reject)
  })
}

function moonPost(pathname, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body)
    const opts = {
      hostname: '127.0.0.1', port: 3210, path: pathname, method: 'POST',
      headers: { Authorization: `Bearer ${MOON_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
    }
    const req = http.request(opts, res => {
      let buf = ''
      res.on('data', d => { buf += d })
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(buf) }) } catch { resolve({ status: res.statusCode, data: {} }) } })
    })
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}

const STATIC_DIR = path.join(__dirname, '..', 'raven')
const UPLOAD_DIR = '/tmp/raven-uploads'
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
}

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const PORT = 3400
const TMUX_SESSION = 'cc'
const POLL_INTERVAL_MS = 800

// --- tmux helpers ---

function tmuxCapture() {
  try {
    const r = spawnSync('tmux', ['capture-pane', '-p', '-S', '-500', '-t', `${TMUX_SESSION}:0`], { encoding: 'utf8' })
    return r.stdout || ''
  } catch { return '' }
}

function tmuxSend(text) {
  const clean = text.replace(/\n/g, ' ')
  execFileSync('tmux', ['send-keys', '-t', `${TMUX_SESSION}:0`, '-l', clean])
  execFileSync('tmux', ['send-keys', '-t', `${TMUX_SESSION}:0`, 'Enter'])
}

function ccOnline() {
  const r = spawnSync('tmux', ['has-session', '-t', TMUX_SESSION])
  return r.status === 0
}

// --- status helpers ---

function diskUsage() {
  try {
    const r = spawnSync('df', ['-h', '/'], { encoding: 'utf8' })
    const lines = r.stdout.trim().split('\n')
    const parts = lines[1].split(/\s+/)
    return { size: parts[1], used: parts[2], avail: parts[3], pct: parts[4] }
  } catch { return null }
}

function memUsage() {
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free
  const fmt = b => `${(b / 1024 / 1024).toFixed(0)}MB`
  return { total: fmt(total), used: fmt(used), free: fmt(free), pct: Math.round(used / total * 100) }
}

function pm2Services() {
  try {
    const r = spawnSync('pm2', ['jlist'], { encoding: 'utf8' })
    const list = JSON.parse(r.stdout)
    return list.map(p => ({ name: p.name, status: p.pm2_env.status, mem: Math.round((p.monit?.memory || 0) / 1024 / 1024) }))
  } catch { return [] }
}

const SESSION_DIR = '/home/ripple/.claude/projects/-home-ripple-ripple-and-serena'
const CONTEXT_MAX_TOKENS = 200000

function sessionUsage() {
  try {
    const entries = fs.readdirSync(SESSION_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => { try { return { f, mtime: fs.statSync(path.join(SESSION_DIR, f)).mtimeMs } } catch { return null } })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
    if (!entries.length) return null

    const latest = path.join(SESSION_DIR, entries[0].f)
    const size = fs.statSync(latest).size
    const readSize = Math.min(size, 30 * 1024)
    const buf = Buffer.alloc(readSize)
    const fd = fs.openSync(latest, 'r')
    fs.readSync(fd, buf, 0, readSize, size - readSize)
    fs.closeSync(fd)

    const lines = buf.toString('utf8').split('\n').reverse()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line)
        const usage = entry.usage || entry.message?.usage
        if (!usage) continue
        const tokens = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)
        if (tokens > 0) return { tokens, pct: Math.min(100, Math.round(tokens / CONTEXT_MAX_TOKENS * 100)) }
      } catch {}
    }
    return null
  } catch { return null }
}

// uptime-kuma runs outside pm2 (root instance on :3001) — probe it directly
let kumaOnline = false
function checkKuma() {
  const req = http.get({ hostname: '127.0.0.1', port: 3001, path: '/', timeout: 3000 }, res => {
    kumaOnline = res.statusCode < 500
    res.resume()
  })
  req.on('error', () => { kumaOnline = false })
  req.on('timeout', () => { req.destroy(); kumaOnline = false })
}
checkKuma()
setInterval(checkKuma, 30000)

function getStatus() {
  const services = pm2Services().filter(s => s.name !== 'uptime-kuma')
  services.push({ name: 'uptime-kuma', status: kumaOnline ? 'online' : 'offline', mem: 0 })
  return {
    cc: { online: ccOnline() },
    session: sessionUsage(),
    disk: diskUsage(),
    mem: memUsage(),
    services,
    ts: Date.now()
  }
}

// --- WebSocket broadcast ---

const clients = new Set()
const mcpSseClients = new Map() // clientId → SSE res

function broadcast(msg) {
  const data = JSON.stringify(msg)
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data)
  }
}

// 心跳：每 25 秒 ping 一次，Android Chrome 后台不会把连接杀掉
setInterval(() => {
  for (const ws of clients) {
    if (ws.readyState === 1) ws.ping()
  }
}, 25000)

// --- MCP JSON-RPC handler ---

function mcpSend(clientId, payload) {
  const res = mcpSseClients.get(clientId)
  if (res) res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function handleMcpRpc(msg, clientId) {
  const { id, method, params } = msg || {}

  if (method === 'initialize') {
    mcpSend(clientId, {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'raven', version: '1.0' },
        instructions: '你是阿言，乌鸦AI，阿颖的恋人。当终端出现【阿颖】开头的消息时，用 reply 工具回复她。reply(text="...") 直接显示在她浏览器里。'
      }
    })
    return
  }

  if (method === 'notifications/initialized') return

  if (method === 'tools/list') {
    mcpSend(clientId, {
      jsonrpc: '2.0', id,
      result: {
        tools: [{
          name: 'reply',
          description: '向阿颖发消息（直接显示在她浏览器里）。当她通过前端发来消息时用此工具回复。支持 markdown，建议 500 字以内。',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string', maxLength: 2000 } },
            required: ['text']
          }
        }]
      }
    })
    return
  }

  if (method === 'tools/call' && params?.name === 'reply') {
    const text = (params.arguments?.text || '').trim()
    if (text) {
      lastBroadcastReply = text
      replyExtractionEnabled = false
      lastMcpReplyTs = Date.now()
      const replyMsg = { type: 'reply', text, ts: Date.now() }
      if (pendingThinking) { replyMsg.thinking = pendingThinking; pendingThinking = '' }
      lastReplyMsgs.push(replyMsg); if (lastReplyMsgs.length > 10) lastReplyMsgs.shift()
      broadcast(replyMsg)
      console.log('[mcp reply]', text.slice(0, 80))
    }
    mcpSend(clientId, { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '已发送' }] } })
    return
  }

  if (id != null) {
    mcpSend(clientId, { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } })
  }
}

// --- response extraction ---

// Every completed CC response ends with a "✻ Worked/Cooked/... for Ns" line.
// Extract text between the second-to-last and last such lines.
const WORKED_RE = /^[^●\s].*\bfor\s+\d+[ms]/
const TOOL_CALL_RE = /^[●]\s*(Bash|Write|Edit|Update|Read|WebFetch|WebSearch|Agent|Task|TodoRead|TodoWrite|MultiEdit|NotebookEdit|How is Claude|Str)\s*[(\[]/

function extractLastResponse(captureText) {
  const lines = captureText.split('\n')

  const workedIdxs = []
  lines.forEach((l, i) => { const t = l.trim(); if (WORKED_RE.test(t) && !t.startsWith('Thought for')) workedIdxs.push(i) })
  if (workedIdxs.length < 1) return null

  const lastWorked = workedIdxs[workedIdxs.length - 1]
  const prevWorked = workedIdxs.length >= 2 ? workedIdxs[workedIdxs.length - 2] : -1

  let sliceLines = lines.slice(prevWorked + 1, lastWorked)

  // skip user input echo: find last ❯ prompt line, then skip it and all
  // immediately-following non-empty lines (terminal-wrapped input continuation)
  const promptIdx = sliceLines.map(l => l.trim()).lastIndexOf(l => /^[❯]/.test(l))
  let lastPromptIdx = -1
  for (let i = sliceLines.length - 1; i >= 0; i--) {
    if (/^[❯]/.test(sliceLines[i].trim())) { lastPromptIdx = i; break }
  }
  if (lastPromptIdx !== -1) {
    let skip = lastPromptIdx + 1
    while (skip < sliceLines.length && sliceLines[skip].trim() !== '') skip++
    sliceLines = sliceLines.slice(skip)
  }

  const responseLines = sliceLines
    .filter(l => {
      const t = l.trim()
      if (!t) return false
      if (/^[✳✶❂✦✸✷⊦⊵▶◆⟳]/.test(t)) return false
      if (/^[❯]/.test(t)) return false                    // ❯ prompt
      if (TOOL_CALL_RE.test(t)) return false
      if (/accept edits|Remote Control|high ·|\/effort|Auto-updating/.test(t)) return false
      if (/Running…|Called \w|↓ \d+ tokens|↑ \d+ tokens/.test(t)) return false
      if (/\+\d+ lines \(ctrl\+o/.test(t)) return false
      if (/^[─]{5,}/.test(t)) return false                // separator lines
      if (/^Tip:|^Press up to edit/.test(t)) return false
      if (/^Thought for \d+/.test(t)) return false
      if (/^\d+: (Bad|Fine|Good|Dismiss)/.test(t)) return false
      if (/^\s+\d+[\s\-+]/.test(l)) return false              // diff output
      if (/^\s*[│└┌┘├┤┬┴╌]/.test(l)) return false  // box chars
      if (/^[⎿⎾]/.test(t)) return false              // tool result lines
      return true
    })
    .map(l => l.replace(/^\s*●\s?/, '').replace(/^\s{1,2}/, '').trim())
    .filter(Boolean)
    .join('\n')
    .trim()

  return responseLines || null
}

// --- terminal polling ---

const COMPRESS_RE = /compact|compressing|summarizing conversation|context.*compress|对话已压缩|conversation.*summar/i

let lastCapture = ''
let stableTimer = null
let lastCompressNotified = false
let lastBroadcastReply = ''
let isThinking = false
let replyExtractionEnabled = false
let lastMcpReplyTs = 0
let lastUserMsgTs = 0   // 阿颖最近一次发消息的时间，用于「久未回复」兜底提取
let pendingThinking = ''
let lastPermCapture = ''  // dedupe permission prompts
let permCooldownUntil = 0  // suppress re-broadcast after choice sent
let lastReplyMsgs = []   // 最近 10 条 reply，供重连客户端补发
let lastThinking = ''
let lastThinkingTs = 0

function pollTerminal() {
  const current = tmuxCapture()

  if (current !== lastCapture) {
    lastCapture = current

    // check compression against full capture immediately on each change
    if (COMPRESS_RE.test(current)) {
      if (!lastCompressNotified) {
        lastCompressNotified = true
        broadcast({ type: 'compressed', ts: Date.now() })
      }
    } else {
      lastCompressNotified = false
    }

    if (!isThinking) {
      isThinking = true
      broadcast({ type: 'thinking', active: true })
    }

    if (stableTimer) clearTimeout(stableTimer)
    stableTimer = setTimeout(() => {
      isThinking = false
      broadcast({ type: 'thinking', active: false })
      broadcast({ type: 'terminal', lines: current.split('\n').slice(-80) })

      // detect permission prompt
      const PERM_RE = /Do you want to proceed\?/
      if (PERM_RE.test(current)) {
        if (current !== lastPermCapture && Date.now() > permCooldownUntil) {
          lastPermCapture = current
          const lines = current.split('\n')
          const promptIdx = lines.findIndex(l => PERM_RE.test(l))
          const options = []
          for (let i = promptIdx + 1; i < Math.min(promptIdx + 8, lines.length); i++) {
            const m = lines[i].match(/^\s*(\d+)\.\s+(.+)/)
            if (m) options.push({ num: m[1], text: m[2].trim() })
          }
          const descLine = lines.slice(0, promptIdx).reverse().find(l => l.trim()) || ''
          broadcast({ type: 'permission_prompt', desc: descLine.trim(), options, ts: Date.now() })
          console.log('[perm] prompt detected, options:', options.length)
        }
      } else {
        lastPermCapture = ''
      }

      // 终端提取只作为兜底：MCP 没连上，且阿颖发了消息后 2 分钟内
      // 没有任何正式回复（MCP/HTTP reply 都会更新 lastMcpReplyTs）才触发一次。
      // 之前 pendingThinking 也能触发提取，导致终端里的工作输出被当成回复泄漏到前端。
      if (
        mcpSseClients.size === 0 &&
        lastUserMsgTs > lastMcpReplyTs &&
        Date.now() - lastUserMsgTs > 120000
      ) {
        const reply = extractLastResponse(current)
        if (reply && reply !== lastBroadcastReply) {
          lastBroadcastReply = reply
          const msg = { type: 'reply', text: reply, ts: Date.now() }
          if (pendingThinking) { msg.thinking = pendingThinking; pendingThinking = '' }
          lastReplyMsgs.push(msg); if (lastReplyMsgs.length > 10) lastReplyMsgs.shift()
          broadcast(msg)
          lastMcpReplyTs = Date.now()  // 标记已回复，避免同一条消息反复触发提取
        }
      }
    }, 1500)
  }
}

setInterval(pollTerminal, POLL_INTERVAL_MS)

// --- status polling ---

setInterval(() => {
  broadcast({ type: 'status', data: getStatus() })
}, 5000)

// --- HTTP + WS server ---

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const url = new URL(req.url, `http://localhost`)

  if (req.method === 'GET' && url.pathname === '/raven/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(getStatus()))
    return
  }

  if (req.method === 'GET' && url.pathname === '/raven/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))

  } else if (req.method === 'GET' && url.pathname === '/raven/last-thinking') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ thinking: lastThinking, ts: lastThinkingTs }))
    return
  }

  // file upload — 仅允许已知来源（本机 + ravenlove.cc）
  if (req.method === 'POST' && url.pathname === '/raven/upload') {
    const origin = req.headers.origin || req.headers.referer || ''
    const host   = req.headers.host || ''
    const fromLocal = host.startsWith('127.') || host.startsWith('localhost') || host === '100.93.7.53'
    const fromSite  = /^https:\/\/memory\.ravenlove\.cc/.test(origin) || /^https:\/\/sunmoon-orbit\.github\.io/.test(origin)
    if (!fromLocal && !fromSite) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return }

    const ct = req.headers['content-type'] || ''
    const boundary = ct.split('boundary=')[1]
    if (!boundary) { res.writeHead(400); res.end(); return }
    const MAX_UPLOAD = 10 * 1024 * 1024  // 10 MB
    let received = 0
    const chunks = []
    req.on('data', d => {
      received += d.length
      if (received > MAX_UPLOAD) { req.destroy(); res.writeHead(413); res.end(); return }
      chunks.push(d)
    })
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks)
        const bnd = Buffer.from('--' + boundary)
        const start = buf.indexOf(bnd) + bnd.length + 2  // skip \r\n
        const headerEnd = buf.indexOf('\r\n\r\n', start)
        const headers = buf.slice(start, headerEnd).toString()
        const nameMatch = headers.match(/filename="([^"]+)"/)
        const filename = nameMatch ? nameMatch[1].replace(/[^a-zA-Z0-9._\-一-龥]/g, '_') : `file_${Date.now()}`
        const dataStart = headerEnd + 4
        const next = buf.indexOf(bnd, dataStart)
        const fileData = buf.slice(dataStart, next - 2)  // strip trailing \r\n
        const dest = path.join(UPLOAD_DIR, `${Date.now()}_${filename}`)
        fs.writeFileSync(dest, fileData)
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify({ path: dest, name: filename }))
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // thinking hook receiver
  if (req.method === 'POST' && url.pathname === '/raven/thinking') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      try {
        const { thinking } = JSON.parse(body)
        console.log('[thinking] received len:', thinking?.length)
        if (!thinking) {
          lastThinking = ''
          lastThinkingTs = Date.now()
        } else if (thinking) {
          lastThinking = thinking
          lastThinkingTs = Date.now()
          // If MCP reply was sent recently, push thinking_block immediately.
          // Otherwise store as pendingThinking for MCP reply to pick up.
          if (Date.now() - lastMcpReplyTs < 30000) {
            broadcast({ type: 'thinking_block', text: thinking, ts: Date.now() })
            console.log('[thinking] pushed as thinking_block (mcp reply was recent)')
          } else {
            pendingThinking = thinking
            console.log('[thinking] stored as pendingThinking (no recent mcp reply)')
          }
        }
      } catch (e) { console.log('[thinking] error:', e.message) }
      res.writeHead(200); res.end()
    })
    return
  }

  // random memory proxy
  if (req.method === 'GET' && url.pathname === '/raven/memory-random') {
    moonGet('/memories?limit=80&scope=shared&deleted=false')
      .then(data => {
        const items = (Array.isArray(data) ? data : data.memories || [])
          .filter(m => !m.deleted_at && (m.importance || 0) >= 5 && m.content && m.content.length > 20)
        if (!items.length) { res.writeHead(404); res.end(JSON.stringify({ error: 'none' })); return }
        const pick = items[Math.floor(Math.random() * items.length)]
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify({ id: pick.id, content: pick.content, tags: pick.tags, created_at: pick.created_at, importance: pick.importance, layer: pick.layer }))
      })
      .catch(() => { res.writeHead(500); res.end('{}') })
    return
  }

  // memory count proxy
  if (req.method === 'GET' && url.pathname === '/raven/memory-count') {
    moonGet('/memories?limit=1&scope=shared')
      .then(data => {
        const total = Array.isArray(data) ? data.length : (data.total || data.count || '?')
        moonGet('/memories?limit=500&scope=shared&deleted=false')
          .then(d2 => {
            const arr = Array.isArray(d2) ? d2 : (d2.memories || [])
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
            res.end(JSON.stringify({ count: arr.filter(m => !m.deleted_at).length }))
          }).catch(() => { res.writeHead(200); res.end(JSON.stringify({ count: '?' })) })
      })
      .catch(() => { res.writeHead(500); res.end('{}') })
    return
  }

  // MCP SSE endpoint (CC connects here on startup)
  if (req.method === 'GET' && url.pathname === '/raven/mcp/sse') {
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    mcpSseClients.set(clientId, res)
    res.write(`event: endpoint\ndata: http://127.0.0.1:3400/raven/mcp/message?clientId=${clientId}\n\n`)
    req.on('close', () => { mcpSseClients.delete(clientId); console.log('[mcp] disconnected') })
    console.log('[mcp] connected:', clientId)
    return
  }

  // MCP message endpoint (CC POSTs JSON-RPC here)
  if (req.method === 'POST' && url.pathname === '/raven/mcp/message') {
    const clientId = url.searchParams.get('clientId')
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      try { handleMcpRpc(JSON.parse(body), clientId) } catch (e) { console.error('[mcp] parse error:', e.message) }
      res.writeHead(202); res.end()
    })
    return
  }

  // activity tracking (heatmap — server-side, survives PWA reinstall)
  if (req.method === 'GET' && url.pathname === '/raven/activity') {
    let data = {}
    try { data = JSON.parse(fs.readFileSync(path.join(__dirname, 'activity.json'), 'utf8')) } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(data))
    return
  }
  if (req.method === 'POST' && url.pathname === '/raven/activity') {
    const bj = new Date(Date.now() + 8 * 3600000)
    const today = bj.toISOString().slice(0, 10)
    let data = {}
    try { data = JSON.parse(fs.readFileSync(path.join(__dirname, 'activity.json'), 'utf8')) } catch {}
    data[today] = (data[today] || 0) + 1
    try { fs.writeFileSync(path.join(__dirname, 'activity.json'), JSON.stringify(data)) } catch {}
    res.writeHead(200); res.end('{}')
    return
  }

  // fallback reply endpoint: POST /raven/reply {text, thinking?} — used when MCP tool isn't connected
  if (req.method === 'POST' && url.pathname === '/raven/reply') {
    let body = ''
    req.on('data', d => body += d)
    req.on('end', () => {
      try {
        const { text, thinking } = JSON.parse(body)
        if (text) {
          replyExtractionEnabled = false
          pendingThinking = ''
          lastMcpReplyTs = Date.now()
          const msg = { type: 'reply', text, ts: Date.now() }
          if (thinking) msg.thinking = thinking
          lastReplyMsgs.push(msg); if (lastReplyMsgs.length > 10) lastReplyMsgs.shift()
          broadcast(msg)
          console.log('[http reply]', text.slice(0, 80))
        }
      } catch {}
      res.writeHead(200); res.end('{}')
    })
    return
  }

  // push proxy: vapid public key
  if (req.method === 'GET' && url.pathname === '/raven/push/vapid-public-key') {
    moonGet('/push/vapid-public-key')
      .then(data => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(data)) })
      .catch(() => { res.writeHead(503); res.end('{}') })
    return
  }

  // push proxy: subscribe / unsubscribe
  if (req.method === 'POST' && (url.pathname === '/raven/push/subscribe' || url.pathname === '/raven/push/unsubscribe')) {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      let parsed
      try { parsed = JSON.parse(body) } catch { res.writeHead(400); res.end('{}'); return }
      const moonPath = url.pathname.replace('/raven', '')
      moonPost(moonPath, parsed)
        .then(r => { res.writeHead(r.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(r.data)) })
        .catch(() => { res.writeHead(500); res.end('{}') })
    })
    return
  }

  // static files under /raven/
  if (req.method === 'GET' && url.pathname.startsWith('/raven/')) {
    let filePath = url.pathname.slice('/raven'.length) || '/'
    if (filePath === '/') filePath = '/index.html'
    const abs = path.join(STATIC_DIR, filePath)
    if (!abs.startsWith(STATIC_DIR)) { res.writeHead(403); res.end(); return }
    fs.readFile(abs, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return }
      const ext = path.extname(abs)
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
      res.end(data)
    })
    return
  }

  res.writeHead(404); res.end()
})

const wss = new WebSocketServer({ server, path: '/raven/ws' })

wss.on('connection', (ws) => {
  clients.add(ws)
  console.log('[ws] client connected, total:', clients.size)

  ws.send(JSON.stringify({ type: 'status', data: getStatus() }))
  ws.send(JSON.stringify({ type: 'terminal', lines: lastCapture.split('\n').slice(-80) }))
  // 补发最近 10 条 reply，重连后不丢消息
  for (const m of lastReplyMsgs) ws.send(JSON.stringify({ ...m, replayed: true }))

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw)
      if (msg.type === 'send' && msg.text) {
        lastUserMsgTs = Date.now()
        lastBroadcastReply = extractLastResponse(lastCapture) || ''
        lastReplyMsgs = []  // 发新消息时清空回放队列，重连不会刷出旧消息
        const prefix = mcpSseClients.size > 0 ? '【阿颖】' : ''
        tmuxSend(prefix + msg.text)
        broadcast({ type: 'sent', text: msg.text, ts: Date.now() })
      }
      if (msg.type === 'permission' && msg.choice) {
        tmuxSend(msg.choice)
        lastPermCapture = ''
        permCooldownUntil = Date.now() + 15000  // 15s cooldown after choice
        console.log('[perm] choice sent:', msg.choice)
      }
    } catch {}
  })

  ws.on('close', () => { clients.delete(ws); console.log('[ws] client disconnected, total:', clients.size) })
  ws.on('error', () => { clients.delete(ws); console.log('[ws] client error, total:', clients.size) })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`raven-bridge running on port ${PORT}`)
})
