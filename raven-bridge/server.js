const http = require('http')
const { WebSocketServer } = require('ws')
const { execFileSync, spawnSync } = require('child_process')
const os = require('os')
const fs = require('fs')
const path = require('path')

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
let pendingThinking = ''
let lastReplyMsg = null  // cached for late-connecting clients
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

      if (replyExtractionEnabled || pendingThinking) {
        const reply = extractLastResponse(current)
        if (reply && reply !== lastBroadcastReply) {
          lastBroadcastReply = reply
          const msg = { type: 'reply', text: reply, ts: Date.now() }
          if (pendingThinking) { msg.thinking = pendingThinking; pendingThinking = '' }
          lastReplyMsg = msg
          broadcast(msg)
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

  // file upload
  if (req.method === 'POST' && url.pathname === '/raven/upload') {
    const ct = req.headers['content-type'] || ''
    const boundary = ct.split('boundary=')[1]
    if (!boundary) { res.writeHead(400); res.end(); return }
    const chunks = []
    req.on('data', d => chunks.push(d))
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
          pendingThinking = thinking
          lastThinking = thinking
          lastThinkingTs = Date.now()
          // delay to let tmux render the ✻ Worked line before extracting reply
          setTimeout(() => {
            const current = tmuxCapture()
            const reply = extractLastResponse(current)
            console.log('[thinking] reply extracted:', JSON.stringify(reply?.slice(0, 80)))
            console.log('[thinking] clients:', clients.size)
            if (reply && reply !== lastBroadcastReply) {
              // terminal poller hasn't sent this reply yet — send reply+thinking together
              lastBroadcastReply = reply
              const replyMsg = { type: 'reply', text: reply, thinking: pendingThinking, ts: Date.now() }
              pendingThinking = ''
              lastReplyMsg = replyMsg
              broadcast(replyMsg)
            } else if (reply && pendingThinking) {
              // terminal poller already sent reply — only push the thinking block
              broadcast({ type: 'thinking_block', text: pendingThinking, ts: Date.now() })
              pendingThinking = ''
            }
          }, 2000)
        }
      } catch (e) { console.log('[thinking] error:', e.message) }
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
  console.log('[ws] client connected, total:', clients.size)

  ws.send(JSON.stringify({ type: 'status', data: getStatus() }))
  ws.send(JSON.stringify({ type: 'terminal', lines: lastCapture.split('\n').slice(-80) }))
  if (lastReplyMsg) ws.send(JSON.stringify({ ...lastReplyMsg, replayed: true }))

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

  ws.on('close', () => { clients.delete(ws); console.log('[ws] client disconnected, total:', clients.size) })
  ws.on('error', () => { clients.delete(ws); console.log('[ws] client error, total:', clients.size) })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`raven-bridge running on port ${PORT}`)
})
