const http = require('http')
const { WebSocketServer } = require('ws')
const { execFileSync, spawnSync } = require('child_process')
const os = require('os')
const fs = require('fs')

const PORT = 3400
const TMUX_SESSION = 'cc'
const POLL_INTERVAL_MS = 800

// --- tmux helpers ---

function tmuxCapture() {
  try {
    const r = spawnSync('tmux', ['capture-pane', '-p', '-t', `${TMUX_SESSION}:0`], { encoding: 'utf8' })
    return r.stdout || ''
  } catch { return '' }
}

function tmuxSend(text) {
  // strip literal newlines to avoid accidental Enter, then send with explicit Enter
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

function getStatus() {
  return {
    cc: { online: ccOnline() },
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

function extractLastResponse(captureText) {
  const lines = captureText.split('\n')
  const isSep = l => /^[─]{10,}/.test(l.trim())

  const seps = []
  lines.forEach((l, i) => { if (isSep(l)) seps.push(i) })
  if (seps.length < 3) return null

  // structure: ... sepB | my response | sepC | ❯ user msg | sepD | toolbar
  const sepC = seps[seps.length - 2]
  const sepB = seps[seps.length - 3]

  // ● prefix = my text response; ● ToolName( = tool call (filter)
  const TOOL_RE = /^●\s*(Bash|Write|Edit|Read|WebFetch|WebSearch|Agent|Task|TodoRead|TodoWrite|How is Claude|Str)\s*[(\[]/
  const responseLines = lines
    .slice(sepB + 1, sepC)
    .filter(l => {
      const t = l.trim()
      if (!t) return false
      if (/^[✶⎿⏵▶◆⟳]/.test(t)) return false          // status/toolbar/tool-output
      if (/^❯/.test(t)) return false                    // prompt lines
      if (TOOL_RE.test(t)) return false                 // tool calls
      if (/accept edits|Remote Control|high ·|\/effort|Auto-updating/.test(t)) return false
      if (/Worked for|Baked for|Running…|Called \w|↓ \d+ tokens|↑ \d+ tokens/.test(t)) return false
      if (/\+\d+ lines \(ctrl\+o/.test(t)) return false
      if (/^Tip:|^Press up to edit/.test(t)) return false
      if (/^\d+: (Bad|Fine|Good|Dismiss)/.test(t)) return false
      return true
    })
    .map(l => l.replace(/^\s*●\s?/, '').replace(/^\s{1,2}/, '').trim())
    .filter(Boolean)
    .join('\n')
    .trim()

  return responseLines || null
}

// --- terminal polling ---

const COMPRESS_RE = /compressing|summarizing conversation|context.*compress|对话已压缩|conversation.*summar/i

let lastCapture = ''
let stableTimer = null
let lastCompressNotified = false
let lastBroadcastReply = ''
let isThinking = false
let replyExtractionEnabled = false  // don't extract on startup, only after first user send

function pollTerminal() {
  const current = tmuxCapture()

  if (current !== lastCapture) {
    lastCapture = current

    // show thinking indicator when terminal is actively changing
    if (!isThinking) {
      isThinking = true
      broadcast({ type: 'thinking', active: true })
    }

    if (stableTimer) clearTimeout(stableTimer)
    stableTimer = setTimeout(() => {
      isThinking = false
      broadcast({ type: 'thinking', active: false })
      broadcast({ type: 'terminal', lines: current.split('\n').slice(-60) })

      // extract and broadcast reply (only after a user message has been sent)
      if (replyExtractionEnabled) {
        const reply = extractLastResponse(current)
        if (reply && reply !== lastBroadcastReply) {
          lastBroadcastReply = reply
          broadcast({ type: 'reply', text: reply, ts: Date.now() })
        }
      }

      // detect context compression
      const recentLines = current.split('\n').slice(-20).join('\n')
      if (COMPRESS_RE.test(recentLines)) {
        if (!lastCompressNotified) {
          lastCompressNotified = true
          broadcast({ type: 'compressed', ts: Date.now() })
        }
      } else {
        lastCompressNotified = false
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

  res.writeHead(404); res.end()
})

const wss = new WebSocketServer({ server, path: '/raven/ws' })

wss.on('connection', (ws) => {
  clients.add(ws)

  // send current state immediately on connect
  ws.send(JSON.stringify({ type: 'status', data: getStatus() }))
  ws.send(JSON.stringify({ type: 'terminal', lines: lastCapture.split('\n').slice(-60) }))

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw)
      if (msg.type === 'send' && msg.text) {
        replyExtractionEnabled = true
        lastBroadcastReply = extractLastResponse(lastCapture) || ''  // snapshot current so we don't re-send it
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
