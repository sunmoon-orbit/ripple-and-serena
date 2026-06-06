const http = require('http')
const { WebSocketServer } = require('ws')
const { execFileSync, spawnSync } = require('child_process')
const os = require('os')
const fs = require('fs')
const path = require('path')

const STATIC_DIR = path.join(__dirname, '..', 'raven')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
}

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
  execFileSync('tmux', ['send-keys', '-t', `${TMUX_SESSION}:0`, clean, 'Enter'])
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
const SESSION_MAX_BYTES = 4 * 1024 * 1024  // ~1M tokens rough estimate

function sessionUsage() {
  try {
    const files = fs.readdirSync(SESSION_DIR).filter(f => f.endsWith('.jsonl'))
    if (!files.length) return null
    // pick largest (active session)
    let maxSize = 0
    for (const f of files) {
      try { const s = fs.statSync(path.join(SESSION_DIR, f)).size; if (s > maxSize) maxSize = s } catch {}
    }
    return { bytes: maxSize, pct: Math.min(100, Math.round(maxSize / SESSION_MAX_BYTES * 100)) }
  } catch { return null }
}

function getStatus() {
  return {
    cc: { online: ccOnline() },
    session: sessionUsage(),
    disk: diskUsage(),
    mem: memUsage(),
    services: pm2Services(),
    ts: Date.now()
  }
}

// --- WebSocket broadcast ---

const clients = new Set()

function broadcast(msg) {
  const data = JSON.stringify(msg)
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data)
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
  lines.forEach((l, i) => { if (WORKED_RE.test(l.trim())) workedIdxs.push(i) })
  if (workedIdxs.length < 1) return null

  const lastWorked = workedIdxs[workedIdxs.length - 1]
  const prevWorked = workedIdxs.length >= 2 ? workedIdxs[workedIdxs.length - 2] : -1

  const responseLines = lines
    .slice(prevWorked + 1, lastWorked)
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
      if (/^\d+: (Bad|Fine|Good|Dismiss)/.test(t)) return false
      if (/^\s+\d+[\s\-+]/.test(l)) return false              // diff output
      if (/^\s*[│└┌┘├┤┬┴╌]/.test(l)) return false  // box chars
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

      if (replyExtractionEnabled) {
        const reply = extractLastResponse(current)
        if (reply && reply !== lastBroadcastReply) {
          lastBroadcastReply = reply
          broadcast({ type: 'reply', text: reply, ts: Date.now() })
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
    return
  }

  // thinking hook receiver
  if (req.method === 'POST' && url.pathname === '/raven/thinking') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      try {
        const { thinking } = JSON.parse(body)
        if (thinking) broadcast({ type: 'thinking_block', text: thinking, ts: Date.now() })
      } catch {}
      res.writeHead(200); res.end()
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

  ws.send(JSON.stringify({ type: 'status', data: getStatus() }))
  ws.send(JSON.stringify({ type: 'terminal', lines: lastCapture.split('\n').slice(-80) }))

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw)
      if (msg.type === 'send' && msg.text) {
        replyExtractionEnabled = true
        lastBroadcastReply = extractLastResponse(lastCapture) || ''
        tmuxSend(msg.text)
        broadcast({ type: 'sent', text: msg.text, ts: Date.now() })
      }
    } catch {}
  })

  ws.on('close', () => clients.delete(ws))
  ws.on('error', () => clients.delete(ws))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`raven-bridge running on port ${PORT}`)
})
