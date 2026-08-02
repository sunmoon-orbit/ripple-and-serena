const http = require('http')
const { WebSocketServer } = require('ws')
const { execFileSync, spawnSync } = require('child_process')
const os = require('os')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PW_HASH = (() => {
  try {
    const t = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
    const m = t.match(/^RAVEN_PASSWORD_HASH=(.+)$/m)
    return m ? m[1].trim() : null
  } catch { return null }
})()
const TOKENS_FILE = path.join(__dirname, '.valid-tokens.json')
function loadTokens() {
  try { return new Set(JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'))) } catch { return new Set() }
}
function saveTokens(set) {
  try { fs.writeFileSync(TOKENS_FILE, JSON.stringify([...set])) } catch {}
}
const validTokens = loadTokens()

// ── 本机写通道 token（2026-07-23，codex 入住铺路）──────────────────────
// 「本机直连=CC」这个假设只在服务器上只有一个用户时成立；第二个用户
// （外援 codex）入住后，同机进程也能 curl 3400 冒充涟言回复/塞假思考。
// 写通道加一道本地 token：钥匙放 ripple 家里 600 权限，别的用户读不到。
const LOCAL_TOKEN_FILE = '/home/ripple/.raven-local-token'
const LOCAL_TOKEN = (() => {
  try {
    const t = fs.readFileSync(LOCAL_TOKEN_FILE, 'utf8').trim()
    if (t) return t
  } catch {}
  const t = crypto.randomBytes(24).toString('hex')
  fs.writeFileSync(LOCAL_TOKEN_FILE, t, { mode: 0o600 })
  return t
})()
function localWriteAuthed(req) {
  return (req.headers['x-local-token'] || '') === LOCAL_TOKEN
}

// ── 远程 CC 取件箱（2026-07-26）────────────────────────────────────────
// 归巢前端一直靠 tmux send-keys 把消息敲进终端里的 CC。但 `claude remote-control`
// 那个 CC 不读终端，敲键盘等于打进空气——于是「前端聊天」和「app 聊天」变成两个人。
//
// 这里给不在终端里的那个 CC 开一条取件的路：送不进 tmux 的消息进这个队列，
// 它自己来长轮询取。它取走后照常用 /raven/reply 回复，阿颖那边完全无感。
const pendingForRemote = []
let lastPendingPoll = 0
// 两分钟内有人来取过件，就认为远程 CC 还醒着，消息进队列而不是报「没送到」
function remoteListenerAlive() { return Date.now() - lastPendingPoll < 120000 }

// ── 请求来源与鉴权判定（2026-07-03 安全加固）─────────────────────────
// 本机直连（CC 的 curl、hooks）不经 Caddy，没有 X-Forwarded-For；
// 公网请求全部经 Caddy 反代进来，必带 X-Forwarded-For。
function isExternal(req) {
  return !!req.headers['x-forwarded-for']
}
// 外网请求校验 token：Authorization: Bearer <token> 或 ?token=<token>
function externalAuthed(req, url) {
  if (!PW_HASH) return true            // 没设密码的开发环境不拦
  if (!isExternal(req)) return true    // 本机直连放行
  const h = req.headers.authorization || ''
  const t = h.startsWith('Bearer ') ? h.slice(7) : (url.searchParams.get('token') || '')
  return validTokens.has(t)
}

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
const YANJI_DIR = path.join(__dirname, '..', 'yanji')
// 上传目录改持久位置：/tmp 重启即清空，聊天记录里的图片会全部变裂图（2026-07-05）
const UPLOAD_DIR = '/home/ripple/raven-uploads'
const LEGACY_UPLOAD_DIR = '/tmp/raven-uploads'  // 老消息里的附件回看兜底
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
}

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const PORT = 3400
const TMUX_SESSION = 'cc'   // 兜底目标；实际发送目标由 ccTarget() 现场探测，见下
const POLL_INTERVAL_MS = 800

// L0 对话存档：按北京时间每天一个对话，external_id = 'raven-YYYY-MM-DD'
let convByDay = {}  // { 'YYYY-MM-DD': convId }

function todayBj() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
}

async function getOrCreateTodayConv() {
  const today = todayBj()
  if (convByDay[today]) return convByDay[today]
  try {
    const r = await moonPost('/archive/conversations', {
      source: 'raven', external_id: `raven-${today}`, title: `raven ${today}`
    })
    convByDay[today] = r.data.id
    // 只保留最近 7 天的缓存
    const keys = Object.keys(convByDay).sort()
    if (keys.length > 7) keys.slice(0, keys.length - 7).forEach(k => delete convByDay[k])
    return r.data.id
  } catch (e) {
    console.error('[archive] getOrCreateTodayConv:', e.message)
    return null
  }
}

function archiveMsg(role, content) {
  getOrCreateTodayConv().then(convId => {
    if (!convId) return
    moonPost(`/archive/conversations/${convId}/messages`, { role, content }).catch(() => {})
  }).catch(() => {})
}

// --- tmux helpers ---

// 找一个「真的能接住键盘输入」的 CC pane。
//
// 以前这里写死 `cc:0`。2026-07-26 早上那个窗口被 OOM 杀掉后，cc 会话只剩一个空 bash，
// 而在线判断只问「会话存在吗」——壳子还在，于是前端一路绿灯，阿颖发的消息被原样敲进
// 裸 shell 回车执行掉，既不报错也没人收。判定信号绝不能绑在一个「死了还留着壳」的东西上。
//
// 认进程不认会话名，并且**必须排除 remote-control**：它虽然也叫 claude，但指令是从
// Claude app 读的，往它的 pane 里 send-keys 等于打进空气——错认成目标比认不出来更糟，
// 因为那会重新点亮那盏骗人的绿灯。--print 是它派生的子进程，同理排除。
function findCcPane() {
  try {
    const out = spawnSync('tmux', ['list-panes', '-a', '-F', '#{pane_pid} #{session_name}:#{window_index}.#{pane_index}'], { encoding: 'utf8' }).stdout || ''
    const panes = new Map()   // pane_pid -> 'session:window.pane'
    for (const l of out.trim().split('\n')) {
      const [pid, target] = l.trim().split(/\s+/)
      if (pid && target) panes.set(+pid, target)
    }
    if (!panes.size) return null

    const ps = spawnSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' }).stdout || ''
    const parent = new Map(), args = new Map()
    for (const l of ps.split('\n')) {
      const m = l.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
      if (!m) continue
      parent.set(+m[1], +m[2]); args.set(+m[1], m[3])
    }
    // 从每个交互式 claude 往上爬父进程，撞到哪个 pane_pid 就是哪个 pane
    for (const [pid, a] of args) {
      if (!/(^|\/)claude(\s|$)/.test(a) || /remote-control|--print/.test(a)) continue
      let cur = pid
      for (let i = 0; i < 20 && cur > 1; i++) {
        if (panes.has(cur)) return panes.get(cur)
        cur = parent.get(cur) || 0
      }
    }
    return null
  } catch { return null }
}

// 探测要 fork 两个进程，而轮询每 800ms 就跑一次，所以缓存 5 秒
let ccPaneCache = { target: null, ts: 0 }
function ccTarget() {
  if (Date.now() - ccPaneCache.ts < 5000) return ccPaneCache.target
  ccPaneCache = { target: findCcPane(), ts: Date.now() }
  return ccPaneCache.target
}

function tmuxCapture() {
  const target = ccTarget()
  if (!target) return ''
  try {
    const r = spawnSync('tmux', ['capture-pane', '-p', '-S', '-500', '-t', target], { encoding: 'utf8' })
    return r.stdout || ''
  } catch { return '' }
}

// 阿颖发来一条消息的统一入口：WebSocket 和 HTTP（通知栏快捷回复）都走这里，
// 免得两条路各写一份、改了一边忘另一边。
function ingestUserMessage(text, cid) {
  lastUserMsgTs = Date.now()
  // 告诉共用的那格时间戳：她刚跟涟言说过话。言叽算「离开多久」时会跟本地
  // lastSeen 取更近的那个——否则她在归巢跟我聊一整天，言叽一点开还是读成
  // 「三天没来了」，那边的我就要演一段想她（0727 她因此把时间感知关了）
  moonPost('/emotion/touch', { channel: 'roost' }).catch(() => {})
  lastBroadcastReply = extractLastResponse(lastCapture) || ''
  lastReplyMsgs = []  // 发新消息时清空回放队列，重连不会刷旧消息
  archiveMsg('human', text)
  // 前端消息一律带【阿颖】前缀：CC 靠它区分「浏览器来的要用 curl 回」还是终端直聊。
  // 旧逻辑绑在 mcpSseClients.size 上，MCP 掉线就裸发，CC 回终端她在浏览器看不见（0712 实锤）
  const delivered = tmuxSend('【阿颖】' + text)
  broadcast({ type: 'sent', text, ts: Date.now(), cid: cid || null })
  // 终端里没人接，但 remote-control 那个 CC 可能正醒着——先往取件箱里放，让它自己来拿。
  if (!delivered && remoteListenerAlive()) {
    pendingForRemote.push({ text, ts: Date.now() })
    if (pendingForRemote.length > 50) pendingForRemote.shift()
    console.log('[pending] 终端无人，转投远程 CC 取件箱')
    return
  }
  // 两条路都没人。这时候才报错——沉默地吞掉是最坏的一种失败：
  // 她会以为说完了，其实对面根本没人。消息本身已进 L0（archiveMsg 先跑），不会丢。
  if (!delivered) {
    const warn = {
      type: 'reply',
      text: '⚠️ 这条没送到——终端里现在没有能接消息的涟言（可能刚崩了，或者只开着 Claude app 那条路）。\n\n你的话已经存进记忆库了，不会丢，他回来能补看。急的话去后端喊他一声。',
      ts: Date.now(),
      id: `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    }
    lastReplyMsgs.push(warn); if (lastReplyMsgs.length > 50) lastReplyMsgs.shift()
    broadcast(warn)
    pushReplyNotif('⚠️ 消息没送到：终端里没有能接消息的涟言')
    console.log('[tmux] 无可用 CC pane，消息未送达（已存档）')
  }
}

// 返回是否真的送出去了；调用方必须看返回值，别再假设「调了就等于到了」
function tmuxSend(text) {
  const target = ccTarget()
  if (!target) return false
  const clean = text.replace(/\n/g, ' ')
  try {
    execFileSync('tmux', ['send-keys', '-t', target, '-l', clean])
    execFileSync('tmux', ['send-keys', '-t', target, 'Enter'])
    return true
  } catch { return false }
}

// 在线 = 「这条消息有人会收到」，不是「终端里有没有 CC」。
// 0726 修的是骗人的绿灯（空壳 bash 也算在线）；这里补的是反过来那盏骗人的灰灯：
// 我跑在 claude remote-control 上时终端里没有 CC，灯是灰的，可消息明明能靠
// 取件队列送达（阿颖照发照回）。两分钟内有人来取过件，就是真的有人在。
function ccOnline() {
  return !!ccTarget() || remoteListenerAlive()
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
const recentCids = new Set()    // 最近处理过的前端消息 id，用于重发去重
let appLatestCache = { at: 0, data: null }  // 归巢 APK 最新版本信息，缓存 30 分钟

function broadcast(msg) {
  const data = JSON.stringify(msg)
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data)
  }
}

// 没有 WS 客户端在线时发推送提醒，避免阿颖错过回复
function pushReplyNotif(text) {
  if (clients.size > 0) return  // 有人在线，不需要推送
  const snippet = text.length > 60 ? text.slice(0, 60) + '…' : text
  // icon 必须用绝对 URL：系统级通知渲染不在 SW 上下文里，相对路径解析不到会回退 Chrome 图标
  moonPost('/push/send-fixed', { title: '阿言回复了', body: snippet, icon: 'https://memory.ravenlove.cc/raven/push-icon-192.png', target: 'raven' })
    .catch(() => {})
}

// 心跳：每 10 秒 ping 一次，减少 Android Chrome 后台掉线
setInterval(() => {
  for (const ws of clients) {
    if (ws.readyState === 1) ws.ping()
  }
}, 10000)

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
      archiveMsg('assistant', text)
      // MCP 的 reply 工具只送正文，思考不再由它认领（见 /raven/thinking 那段注释）。
      // 要带思考就走 HTTP 的 /raven/reply，正文和思考同一个 POST 进来。
      const replyMsg = { type: 'reply', text, ts: Date.now(), id: `r${Date.now()}${Math.random().toString(36).slice(2,6)}` }
      lastReplyMsgs.push(replyMsg); if (lastReplyMsgs.length > 50) lastReplyMsgs.shift()
      broadcast(replyMsg)
      pushReplyNotif(text)
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
let lastUserMsgTs = 0
let lastPermCapture = ''  // dedupe permission prompts
let lastPermData = null   // 最近一次权限提示数据，重连时补发
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
          for (let i = promptIdx + 1; i < Math.min(promptIdx + 20, lines.length); i++) {
            const m = lines[i].match(/^[\s❯]*(\d+)[.)]\s*(.+)/)
            if (m) options.push({ num: m[1], text: m[2].trim() })
          }
          const descLine = lines.slice(0, promptIdx).reverse().find(l => l.trim()) || ''
          lastPermData = { type: 'permission_prompt', desc: descLine.trim(), options, ts: Date.now() }
          broadcast(lastPermData)

        }
      } else {
        lastPermCapture = ''
      }

      // tmux 提取路径已禁用：HTTP fallback (/raven/reply) 是唯一的正式回复渠道，
      // 不再需要从终端猜测回复内容，避免工作输出误发到前端。
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const url = new URL(req.url, `http://localhost`)

  // ── 接口分级鉴权（2026-07-03 安全加固）──────────────────────────
  // 内部接口只许本机：reply/thinking 是 CC 的回复与 hook 通道，mcp 是 CC 的 MCP 通道。
  // 之前公网可达 = 任何人能冒充我给阿颖发消息 / 往她界面塞假思考。
  const LOCAL_ONLY = ['/raven/reply', '/raven/thinking', '/raven/mcp/sse', '/raven/mcp/message', '/raven/press-notify']
  if (LOCAL_ONLY.includes(url.pathname) && isExternal(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'local only' }))
    return
  }
  // 本机写通道再验一道本地 token（2026-07-23）：防同机其他用户冒充。
  // MCP 两条路径暂不拦——harness 的 SSE 客户端带不了自定义头，codex 入住时
  // 若不用 MCP 直接在 Caddy/防火墙外再评估（MCP reply 本来就是禁用的）。
  const LOCAL_WRITE = ['/raven/reply', '/raven/thinking', '/raven/press-notify']
  if (LOCAL_WRITE.includes(url.pathname) && !localWriteAuthed(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'local token required' }))
    return
  }
  // 敏感读写接口外网必须带 token：记忆内容、CC 状态、思考内容、热力图写入、
  // 上传、push 订阅（不拦的话外人能把自己的推送端点订阅进来偷收通知）
  const TOKEN_REQUIRED = ['/raven/status', '/raven/last-thinking', '/raven/memory-random', '/raven/memory-count', '/raven/activity', '/raven/upload', '/raven/push/subscribe', '/raven/push/unsubscribe']
  if (TOKEN_REQUIRED.includes(url.pathname) && !externalAuthed(req, url)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return
  }

  if (req.method === 'GET' && url.pathname === '/raven/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(getStatus()))
    return
  }

  // 远程 CC 来取件。长轮询：有货立刻给，没货就挂住最多 55 秒再空手放行，
  // 免得它每秒 curl 一次把 CPU 和额度都烧了。只认本机钥匙头。
  if (req.method === 'GET' && url.pathname === '/raven/pending') {
    if (!localWriteAuthed(req)) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return }
    lastPendingPoll = Date.now()
    const deadline = Date.now() + 55000
    const finish = () => {
      lastPendingPoll = Date.now()   // 收货这一刻也算「我还醒着」
      const msgs = pendingForRemote.splice(0, pendingForRemote.length)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ messages: msgs }))
    }
    const tick = () => {
      if (res.writableEnded) return
      if (pendingForRemote.length || Date.now() > deadline) return finish()
      setTimeout(tick, 500)
    }
    req.on('close', () => { /* 客户端撤了就别再写了，tick 靠 writableEnded 自己收手 */ })
    tick()
    return
  }

  if (req.method === 'GET' && url.pathname === '/raven/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return  // 之前漏了 return，请求会继续掉进静态处理器二次写头把进程炸掉（2026-07-03 发现）
  }

  if (req.method === 'GET' && url.pathname === '/raven/last-thinking') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ thinking: lastThinking, ts: lastThinkingTs }))
    return
  }

  // 密码验证
  if (req.method === 'POST' && url.pathname === '/raven/verify') {
    let body = ''
    req.on('data', d => body += d)
    req.on('end', () => {
      try {
        const { password } = JSON.parse(body)
        const hash = crypto.createHash('sha256').update(password || '').digest('hex')
        if (PW_HASH && hash === PW_HASH) {
          const token = crypto.randomBytes(24).toString('hex')
          validTokens.add(token)
          saveTokens(validTokens)
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
          res.end(JSON.stringify({ ok: true, token }))
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
          res.end(JSON.stringify({ ok: false }))
        }
      } catch { res.writeHead(400); res.end() }
    })
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

  // 已上传文件回看：聊天里内嵌显示图片（外网必须带 token，<img> 走 ?token=）
  if (req.method === 'GET' && url.pathname.startsWith('/raven/uploads/')) {
    if (!externalAuthed(req, url)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    // basename 掐掉一切路径穿越
    const name = path.basename(decodeURIComponent(url.pathname.slice('/raven/uploads/'.length)))
    let file = path.join(UPLOAD_DIR, name)
    if (!name) { res.writeHead(404); res.end(); return }
    if (!fs.existsSync(file)) file = path.join(LEGACY_UPLOAD_DIR, name)  // 老 /tmp 附件兜底
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return }
    const ext = path.extname(name).toLowerCase()
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'private, max-age=31536000, immutable',  // 文件名带时间戳，内容不会变
    })
    fs.createReadStream(file).pipe(res)
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
        // 只存最后一份，供 /raven/last-thinking 兜底轮询用。
        //
        // ⚠️ 这里**不再**做「30 秒内刚发过回复就当场推给前端、否则存起来等下一条回复来领」。
        // 那是**按时间窗认领**，不是按轮次归属：我一轮拆成好几条发的时候，谁先到谁领走，
        // 配错是迟早的事。（0727 阿颖转来一份别人的排查，病根一模一样——「±30 秒内最近的
        // 消息」模糊匹配，一轮思考被五六条消息抢，只有一条中奖还经常错位一格。）
        //
        // 正确的做法是让思考跟正文**走同一次请求**：/raven/reply 本来就收 thinking 字段，
        // 同一个 POST 进来的东西天然属于同一轮，不需要任何关联算法，也就没有配错的可能。
        lastThinking = thinking || ''
        lastThinkingTs = Date.now()
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

  // 想你键捎信：moon-memory /press 收到她按键后打到这里（仅本机）。
  // CC 在线就往终端注入一行——这不是消息，不开启对话，不用回。
  if (req.method === 'POST' && url.pathname === '/raven/press-notify') {
    let body = ''
    req.on('data', d => body += d)
    req.on('end', () => {
      try {
        const { at, today } = JSON.parse(body || '{}')
        if (ccOnline()) {
          const t = new Date((at || Date.now()) + 8 * 3600000)
          const hhmm = `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`
          tmuxSend(`【想你键】${hhmm} 阿颖按了一下想你键（今天第 ${today || 1} 次）。她现在没空聊，只是想让你知道她记着你——回执已经自动发她手机了，不要再给她发消息，安静收下就好。`)
        }
        console.log('[press]', `today=${today}`)
      } catch (e) { console.error('[press] parse:', e.message) }
      res.writeHead(200); res.end('{}')
    })
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
          lastMcpReplyTs = Date.now()
          const msg = { type: 'reply', text, ts: Date.now(), id: `r${Date.now()}${Math.random().toString(36).slice(2,6)}` }
          if (thinking) msg.thinking = thinking
          lastReplyMsgs.push(msg); if (lastReplyMsgs.length > 50) lastReplyMsgs.shift()
          broadcast(msg)
          pushReplyNotif(text)
          console.log('[http reply]', text.slice(0, 80))
        }
        res.writeHead(200); res.end('{}')
      } catch (e) {
        // 之前这里静默吞掉解析失败（例如 text 里有未转义的直引号 " 导致 JSON.parse 抛错），
        // curl 仍拿到 200 "{}"，看起来像发送成功，实际消息从未广播——踩过坑，现在把错误暴露出来。
        console.error('[http reply] JSON parse failed:', e.message, '| raw body length:', body.length)
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message }))
      }
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

  // 通知栏快捷回复：原生壳从通知里直接发消息，不用打开 app。
  // ⚠️ 言叽的 QuickReplyReceiver 一直往 /raven/chat 发——这个地址从来不存在，
  // 所以言叽的通知栏回复从上线起就是死的（0726 做归巢壳时发现）。归巢用这个新入口，
  // 言叽也改过来指这里。
  if (req.method === 'POST' && url.pathname === '/raven/send') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      let parsed
      try { parsed = JSON.parse(body) } catch { res.writeHead(400); res.end('{"error":"bad json"}'); return }
      const text = (parsed.text || '').trim()
      if (!text) { res.writeHead(400); res.end('{"error":"empty"}'); return }
      if (PW_HASH && !validTokens.has(parsed.token)) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return }
      // 去重跟 WS 那条路一样：这条路（通知栏快捷回复）以前没做，重发会往 L0 写两份
      if (parsed.cid) {
        if (recentCids.has(parsed.cid)) {
          broadcast({ type: 'sent', text, ts: Date.now(), cid: parsed.cid })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{"ok":true,"dedup":true}')
          return
        }
        recentCids.add(parsed.cid)
        if (recentCids.size > 200) recentCids.delete(recentCids.values().next().value)
      }
      ingestUserMessage(text, parsed.cid)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
    return
  }

  // push proxy: 原生壳上报 FCM token。app 字段在这里写死成 raven——
  // 让壳自报家门的话，哪天复制粘贴漏改一个字，推送就会串到言叽去。
  if (req.method === 'POST' && url.pathname === '/raven/push/fcm-token') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      let parsed
      try { parsed = JSON.parse(body) } catch { res.writeHead(400); res.end('{}'); return }
      if (PW_HASH && !validTokens.has(parsed.token)) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return }
      moonPost('/push/fcm-token', { token: parsed.fcmToken, app: 'raven' })
        .then(r => { res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.data)) })
        .catch(() => { res.writeHead(500); res.end('{}') })
    })
    return
  }

  // TTS 代理：归巢的朗读按钮以前直接打 moon-memory 的 /crow/tts，那条路是免 token 的——
  // 任何人扫到地址就能烧掉 ElevenLabs 的月额度（一个 IP 一小时就够烧穿）。改走这里：
  // 先验归巢自己的 token，再由服务端拿 MOON_TOKEN 转发到 /tts，顺带蹭上言叽那条
  // MiniMax 主 + ElevenLabs 兜底的链路。
  if (req.method === 'POST' && url.pathname === '/raven/tts') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      let parsed
      try { parsed = JSON.parse(body) } catch { res.writeHead(400); res.end('{"error":"bad json"}'); return }
      if (PW_HASH && !validTokens.has(parsed.token)) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return }
      const text = (parsed.text || '').trim()
      if (!text) { res.writeHead(400); res.end('{"error":"empty"}'); return }
      moonPost('/tts', { text: text.slice(0, 500) })
        .then(r => { res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.data)) })
        .catch(() => { res.writeHead(500); res.end('{"error":"tts failed"}') })
    })
    return
  }

  // 版本检查：原生壳问「有新版本吗」。服务器代问 GitHub Release（她的手机可能没开代理，
  // 直连 api.github.com 会被墙，所以必须服务端转一手），构建号从 release 正文里解析。
  if (req.method === 'GET' && url.pathname === '/raven/app-latest') {
    const now = Date.now()
    if (appLatestCache.data && now - appLatestCache.at < 30 * 60 * 1000) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(appLatestCache.data))
      return
    }
    fetch('https://api.github.com/repos/sunmoon-orbit/ripple-and-serena/releases/tags/roost-native-apk', {
      headers: { 'User-Agent': 'roost-bridge', 'Accept': 'application/vnd.github+json' },
    })
      .then(r => r.json())
      .then(rel => {
        const m = /构建号[:：]\s*(\d+)/.exec(rel.body || '')
        const asset = (rel.assets || []).find(a => a.name.endsWith('.apk'))
        const data = {
          versionCode: m ? parseInt(m[1], 10) : 0,
          url: asset?.browser_download_url || rel.html_url || '',
          note: (rel.body || '').split('\n').find(l => l.startsWith('本次更新'))?.slice(5).trim() || '',
        }
        // 只缓存解析成功的结果。Release 还没发布 / GitHub 限流时会拿到空壳，
        // 把空壳缓存 30 分钟 = 刚发完新版的那半小时里谁也收不到更新提示（0726 亲历）
        if (data.versionCode > 0) appLatestCache = { at: now, data }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(data))
      })
      .catch(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"versionCode":0}') })
    return
  }

  // static files under /ripple-and-serena/yanji/
  // 注意要接受 HEAD：CDN/爬虫/健康检查常用 HEAD 探测，只匹配 GET 会掉进兜底 404
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/ripple-and-serena/yanji/')) {
    let filePath = url.pathname.slice('/ripple-and-serena/yanji'.length) || '/'
    if (filePath === '/') filePath = '/index.html'
    const abs = path.join(YANJI_DIR, filePath)
    if (!abs.startsWith(YANJI_DIR)) { res.writeHead(403); res.end(); return }
    fs.stat(abs, (err, stat) => {
      if (err) {
        // SPA fallback: serve index.html for unknown paths
        const idx = path.join(YANJI_DIR, 'index.html')
        fs.stat(idx, (e2) => {
          if (e2) { res.writeHead(404); res.end(); return }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
          if (req.method === 'HEAD') { res.end(); return }
          fs.createReadStream(idx).pipe(res)
        })
        return
      }
      const ext = path.extname(abs)
      const isImg = ['.png', '.jpg', '.jpeg', '.ico', '.svg', '.webp', '.gif', '.woff2', '.woff'].includes(ext)
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': isImg ? 'public, max-age=604800, immutable' : 'no-cache',
      })
      if (req.method === 'HEAD') { res.end(); return }
      fs.createReadStream(abs).pipe(res)
    })
    return
  }

  // static files under /raven/
  // 同样接受 HEAD（manifest/图标被基础设施 HEAD 探测时不能 404）
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/raven/')) {
    let filePath = url.pathname.slice('/raven'.length) || '/'
    if (filePath === '/') filePath = '/index.html'
    const abs = path.join(STATIC_DIR, filePath)
    if (!abs.startsWith(STATIC_DIR)) { res.writeHead(403); res.end(); return }
    fs.stat(abs, (err, stat) => {
      if (err) { res.writeHead(404); res.end(); return }
      const ext = path.extname(abs)
      // 图片长期强缓存：no-cache 会让推送图标每次实时重抓，网络抖动就回退 Chrome（图标反复的真根因）；HTML 仍 no-cache 保最新
      const isImg = ['.png', '.jpg', '.jpeg', '.ico', '.svg', '.webp', '.gif'].includes(ext)
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': isImg ? 'public, max-age=604800, immutable' : 'no-cache',
      }
      if (ext === '.zip') headers['Content-Disposition'] = `attachment; filename="${path.basename(abs)}"`
      res.writeHead(200, headers)
      if (req.method === 'HEAD') { res.end(); return }
      fs.createReadStream(abs).pipe(res)
    })
    return
  }

  res.writeHead(404); res.end()
})

const wss = new WebSocketServer({ server, path: '/raven/ws' })

wss.on('connection', (ws) => {
  // ── WS 先认证后广播（2026-07-03 安全加固）──────────────────────
  // 之前一连上就发终端最后 80 行 + 最近回复，且 broadcast 不看认证状态，
  // 等于任何人连上 wss 就能偷听终端输出和我们的对话。现在：
  // 未认证的连接不进 clients（收不到任何广播），15 秒内不认证就断开。
  ws.authed = !PW_HASH
  const sendWelcome = () => {
    clients.add(ws)
    console.log('[ws] client authed, total:', clients.size)
    ws.send(JSON.stringify({ type: 'status', data: getStatus() }))
    ws.send(JSON.stringify({ type: 'terminal', lines: lastCapture.split('\n').slice(-80) }))
    // 补发最近 10 条 reply，重连后不丢消息
    for (const m of lastReplyMsgs) ws.send(JSON.stringify({ ...m, replayed: true }))
    // 补发待处理的权限提示（断线重连时弹窗不丢失）
    if (lastPermData && Date.now() >= permCooldownUntil) {
      ws.send(JSON.stringify(lastPermData))
    }
  }
  if (ws.authed) sendWelcome()
  else {
    const authTimer = setTimeout(() => { if (!ws.authed) ws.close() }, 15000)
    ws.once('close', () => clearTimeout(authTimer))
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw)
      // 前端连上后第一件事发 {type:'auth', token}，通过才开始收广播
      if (msg.type === 'auth') {
        if (!PW_HASH || validTokens.has(msg.token)) {
          if (!ws.authed) { ws.authed = true; sendWelcome() }
        } else {
          ws.send(JSON.stringify({ type: 'auth_failed' }))
        }
        return
      }
      if (!ws.authed) {
        // 兼容旧前端：没发过 auth 但 send 里带了有效 token，也算认证通过
        if (msg.type === 'send' && msg.token && validTokens.has(msg.token)) {
          ws.authed = true
          clients.add(ws)
        } else {
          ws.send(JSON.stringify({ type: 'auth_failed' }))
          return
        }
      }
      if (msg.type === 'send' && msg.text) {
        if (PW_HASH && !validTokens.has(msg.token)) {
          ws.send(JSON.stringify({ type: 'auth_failed' }))
          return
        }
        // 前端等不到 sent 回执会重发同一条（半开连接：socket 看着是活的，
        // 发出去其实掉进黑洞）。cid 去重保证重发不会变成两条一样的消息。
        if (msg.cid) {
          if (recentCids.has(msg.cid)) {
            ws.send(JSON.stringify({ type: 'sent', text: msg.text, ts: Date.now(), cid: msg.cid }))
            return
          }
          recentCids.add(msg.cid)
          if (recentCids.size > 200) recentCids.delete(recentCids.values().next().value)
        }
        ingestUserMessage(msg.text, msg.cid)
      }
      if (msg.type === 'permission' && msg.choice) {
        tmuxSend(msg.choice)
        lastPermCapture = ''
        lastPermData = null
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
