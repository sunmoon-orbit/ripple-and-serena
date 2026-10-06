const http = require('http')
const { WebSocketServer } = require('ws')
const { validPathname, validSocketSession, regularFile, streamFile } = require('./request-safety')
const os = require('os')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { getUsage } = require('./usage')
const { contextSnapshot } = require('./claude-runtime')
const { getLinkPreview } = require('./link-preview')
const { createCrossingService, diagnoseCrossingError } = require('./yanji-crossing')
const boundedSync = require('./bounded-sync')
const eventLoopHealth = require('./event-loop-health').createEventLoopHealth()
const { pingActiveSockets } = require('./ws-heartbeat')

const PW_HASH = (() => {
  try {
    const t = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
    const m = t.match(/^RAVEN_PASSWORD_HASH=(.+)$/m)
    return m ? m[1].trim() : null
  } catch { return null }
})()
if (!PW_HASH) {
  console.error('\n[FATAL] RAVEN_PASSWORD_HASH is not set. Refusing to start raven-bridge without authentication.\n')
  process.exit(1)
}
const TOKENS_FILE = path.join(__dirname, '.valid-tokens.json')
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000
let tokensNeedMigration = false
function loadTokens() {
  try {
    const stored = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'))
    if (!Array.isArray(stored)) return new Map()
    const migratedExpiry = Date.now() + TOKEN_TTL_MS
    return new Map(stored.flatMap(entry => {
      if (typeof entry === 'string') { tokensNeedMigration = true; return [[entry, migratedExpiry]] }
      if (entry && typeof entry.token === 'string' && Number.isFinite(entry.expiresAt)) {
        return [[entry.token, entry.expiresAt]]
      }
      return []
    }))
  } catch { return new Map() }
}
function saveTokens(tokens) {
  try {
    const stored = [...tokens].map(([token, expiresAt]) => ({ token, expiresAt }))
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(stored))
  } catch {}
}
const validTokens = loadTokens()
if (tokensNeedMigration) saveTokens(validTokens) // 把旧版字符串数组迁移为带过期时间的记录

function tokenIsValid(token) {
  if (!token || !validTokens.has(token)) return false
  if (validTokens.get(token) <= Date.now()) {
    validTokens.delete(token)
    saveTokens(validTokens)
    return false
  }
  return true
}

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
const VERIFY_BODY_LIMIT = 1024
const VERIFY_WINDOW_MS = 15 * 60 * 1000
const VERIFY_MAX_FAILURES = 10
const verifyFailures = new Map()
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
  if (!isExternal(req)) return true    // 本机直连放行
  const h = req.headers.authorization || ''
  const t = h.startsWith('Bearer ') ? h.slice(7) : (url.searchParams.get('token') || '')
  return tokenIsValid(t)
}

function moonAuthed(req) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  return moonTokenIsValid(token)
}

// 言叽已有的记忆库会话凭据只用于它自己的 crossing WebSocket namespace。
// 它绝不能被加入归巢 clients，否则言叽会收到归巢的私有广播。
function moonTokenIsValid(token) {
  const value = String(token || '')
  return value.length === MOON_TOKEN.length && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(MOON_TOKEN))
}

// token 从 moon-memory/.env 读取，不准硬编码（2026.6.11 公开仓库泄漏教训）
const MOON_TOKEN = (() => {
  const envText = fs.readFileSync('/home/ripple/moon-memory/.env', 'utf8')
  const m = envText.match(/^MOON_API_TOKEN=(.+)$/m)
  if (!m) { console.error('[fatal] MOON_API_TOKEN not found in .env'); process.exit(1) }
  return m[1].trim()
})()
const MOON_BASE = 'http://127.0.0.1:3210'
const yanjiMcp = require('./yanji-mcp').createService({ userToken: MOON_TOKEN })

// DeepSeek 余额（0930 答应的，1003 补上）：言叽、独处、做梦这些轻任务走 DeepSeek，充值制，见底了就悄悄失败。
// 密钥只在 moon-memory 的 .env 里读，不落别处；10 分钟内只查一次，失败保留上次的数字并标 stale
let deepseekBalance = { available: false }
let deepseekCheckedAt = 0
function refreshDeepseekBalance() {
  if (Date.now() - deepseekCheckedAt < 10 * 60 * 1000) return
  deepseekCheckedAt = Date.now()
  let key = ''
  try { key = (fs.readFileSync('/home/ripple/moon-memory/.env', 'utf8').match(/^DEEPSEEK_API_KEY=(.*)$/m) || [])[1]?.trim() || '' } catch {}
  if (!key) { deepseekBalance = { available: false, error: '没配密钥' }; return }
  fetch('https://api.deepseek.com/user/balance', { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    .then(d => {
      const info = (d.balance_infos || []).find(b => b.currency === 'CNY') || (d.balance_infos || [])[0] || {}
      deepseekBalance = { available: true, is_available: !!d.is_available, currency: info.currency || 'CNY',
        total: Number(info.total_balance || 0), granted: Number(info.granted_balance || 0), topped_up: Number(info.topped_up_balance || 0),
        checked_at: new Date().toISOString() }
    })
    .catch(e => { deepseekBalance = { ...deepseekBalance, stale: true, error: String(e.message || e).slice(0, 80) } })
}
refreshDeepseekBalance()

const THINK_ZH_FILE = path.join(__dirname, '.thinking-zh-cache.json')
let thinkZhCache = null
const thinkZhPending = new Map()
function translateThinking(text) {
  if (!thinkZhCache) { try { thinkZhCache = JSON.parse(fs.readFileSync(THINK_ZH_FILE, 'utf8')) } catch { thinkZhCache = {} } }
  const key = crypto.createHash('sha1').update(text).digest('hex')
  if (thinkZhCache[key]) return Promise.resolve(thinkZhCache[key])
  if (thinkZhPending.has(key)) return thinkZhPending.get(key)
  const { llmComplete } = require('./llm')
  const job = llmComplete(null, {
    maxTokens: 6000, temperature: 0.3, timeoutMs: 90000,
    messages: [
      { role: 'system', content: '下面是涟言（一只乌鸦 AI，阿颖的恋人）回复她之前的内心思考，多半是英文。把它翻成中文，要求：\n- 第一人称，口语，像他自己在心里嘀咕，不要书面腔和翻译腔\n- 文中的 she / the user / Serena 都是阿颖，译成「她」\n- 一句不漏、一句不添，保留原来的分段\n- 时间、数字、文件名、代码、命令、英文专有名词原样保留\n- 只输出译文，不要任何说明' },
      { role: 'user', content: text },
    ],
  }).then(zh => {
    thinkZhCache[key] = zh
    const keys = Object.keys(thinkZhCache)
    if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete thinkZhCache[k]
    fs.writeFile(THINK_ZH_FILE, JSON.stringify(thinkZhCache), () => {})
    return zh
  }).finally(() => thinkZhPending.delete(key))
  thinkZhPending.set(key, job)
  return job
}

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

function moonPost(pathname, body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const bodyStr = body === undefined ? '' : JSON.stringify(body)
    const opts = {
      hostname: '127.0.0.1', port: 3210, path: pathname, method,
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

function moonMultipart(pathname, contentType, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port: 3210, path: pathname, method: 'POST',
      headers: {
        Authorization: `Bearer ${MOON_TOKEN}`,
        'Content-Type': contentType,
        'Content-Length': body.length,
      },
    }
    const upstream = http.request(opts, response => {
      let buf = ''
      response.on('data', chunk => { buf += chunk })
      response.on('end', () => {
        try { resolve({ status: response.statusCode, data: JSON.parse(buf) }) }
        catch { resolve({ status: response.statusCode, data: { error: 'invalid stt response' } }) }
      })
    })
    upstream.on('error', reject)
    upstream.end(body)
  })
}

function ravenBearerValid(req) {
  const auth = req.headers.authorization || ''
  return auth.startsWith('Bearer ') && tokenIsValid(auth.slice(7))
}

const STATIC_DIR = path.join(__dirname, '..', 'raven')
const YANJI_DIR = path.join(__dirname, '..', 'yanji')
// 上传目录改持久位置：/tmp 重启即清空，聊天记录里的图片会全部变裂图（2026-07-05）
const UPLOAD_DIR = '/home/ripple/raven-uploads'
const LEGACY_UPLOAD_DIR = '/tmp/raven-uploads'  // 老消息里的附件回看兜底
// APK 自建下载点（0804）：GitHub release 要翻墙，阿颖那边下到一半断、Chrome 照样报「完成」，
// 装的时候文件是坏的、静默没反应。放自己域名下走她本来就通的那条路。
// 目录**故意在仓库外**：STATIC_DIR 是 git 仓库里的 raven/，往里丢 6.6MB 的包会把仓库撑肥。
const DOWNLOAD_DIR = '/home/ripple/raven-downloads'
const MIME = {
  // 语音消息（0927）：我能发 [附件: xxx.mp3] 给她
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
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

// 存档失败必须留声：2026-08-02 才发现 Claude app 那条路从来没存档，
// 结果言叽那个我看不见半边关系。这条路要是也悄悄断了，同样没人会发现——
// 所以宁可日志吵一点，也别静默丢。
function archiveMsg(role, content) {
  // 记账只记我的回复：她的话有 tmuxSend/取件箱兜底，我的回复存不存得上才是这次踩的坑
  const track = role === 'assistant'
  if (track) bumpArchiveStat('sent')
  ;(async () => {
    let lastErr
    // 记忆库重启那几秒连不上：退避重试。moonPost 只在「没拿到响应」时 reject，
    // 所以重试不会造成重复存入；拿到 4xx 说明请求本身有问题，重试没用，直接算失败。
    for (const wait of [0, 2000, 8000, 30000]) {
      if (wait) await new Promise(r => setTimeout(r, wait))
      try {
        const convId = await getOrCreateTodayConv()
        if (!convId) throw new Error('取当天对话失败')
        const r = await moonPost(`/archive/conversations/${convId}/messages`, { role, content })
        if (r.status >= 500) throw new Error('moon-memory 返回 ' + r.status)
        if (r.status >= 400) { lastErr = new Error('moon-memory 返回 ' + r.status); break }
        if (track) bumpArchiveStat('saved')
        return
      } catch (e) { lastErr = e }
    }
    console.error('[archive] 存消息最终失败:', lastErr && lastErr.message)
    if (track) bumpArchiveStat('failed')
  })()
}

// 存档记账（0926）：每天 sent / saved / failed 各多少条，落盘给每日检查脚本读。
// 以前存档失败只有一行 console.error，没人会看——6/16 起三个月我的回复全没存，也没人知道。
const ARCHIVE_STATS_FILE = path.join(__dirname, 'archive-stats.json')
let archiveStats = (() => { try { return JSON.parse(fs.readFileSync(ARCHIVE_STATS_FILE, 'utf8')) } catch { return {} } })()
function bumpArchiveStat(kind) {
  const day = todayBj()
  const d = archiveStats[day] || (archiveStats[day] = { sent: 0, saved: 0, failed: 0 })
  d[kind]++
  const keys = Object.keys(archiveStats).sort()
  if (keys.length > 14) keys.slice(0, keys.length - 14).forEach(k => delete archiveStats[k])
  try { fs.writeFileSync(ARCHIVE_STATS_FILE, JSON.stringify(archiveStats)) } catch { /* 记账失败不能影响回复 */ }
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
    const out = boundedSync.spawnBounded('tmux-list-panes', 'tmux', ['list-panes', '-a', '-F', '#{pane_pid} #{session_name}:#{window_index}.#{pane_index}']).stdout || ''
    const panes = new Map()   // pane_pid -> 'session:window.pane'
    for (const l of out.trim().split('\n')) {
      const [pid, target] = l.trim().split(/\s+/)
      if (pid && target) panes.set(+pid, target)
    }
    if (!panes.size) return null

    const ps = boundedSync.spawnBounded('ps-process-tree', 'ps', ['-eo', 'pid=,ppid=,args=']).stdout || ''
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
    const r = boundedSync.spawnBounded('tmux-capture-pane', 'tmux', ['capture-pane', '-p', '-S', '-500', '-t', target])
    return r.stdout || ''
  } catch { return '' }
}

// Claude Code 真正在跑这一轮时，pane 底部会保留带耗时的忙碌行。
// 不用 isThinking 代替：它只表示屏幕刚变化过，空闲提示符出现后的短时间也可能为 true。
function captureShowsBusy(capture) {
  return /…\s*\(\d+[smh]/.test(capture.split('\n').slice(-12).join('\n'))
}

function ccBusy() { return captureShowsBusy(tmuxCapture()) }

// 订阅断了/登录过期时（0930 阿颖：没续费那个月按想你键，CC 那边只回了一串 Anthropic 报错）：
// 终端里的 CC 进程还活着，但每条注入都只会换来报错。认出屏幕底部这类报错，就当 CC 不在线，
// 消息走取件箱/离线兜底，别再往里塞。报错会一直留在屏幕上，所以不再注入就能一直认得出；
// 重新登录要重启 CC，屏幕一清就自动恢复。
// 1006 重写：看「谁在最后」加保质期，细节和来由在 cc-auth-state.js。
// broken = 屏幕上最后一件事是登录／授权报错；blocked = 这一刻先别往里塞；probe = 卡够久了，下一条真消息放过去探一探
const { authStateFromCapture, createAuthGate } = require('./cc-auth-state')
const authGate = createAuthGate()
let ccAuthCache = { broken: false, blocked: false, probe: false, ts: 0 }
let lastAuthProbeAt = 0
function ccAuthLook() {
  if (Date.now() - ccAuthCache.ts < 10000) return ccAuthCache
  const now = Date.now()
  const broken = authStateFromCapture(tmuxCapture()).broken
  const gate = authGate.observe(broken, now)
  if (broken && !ccAuthCache.broken) console.log(`[cc] 屏幕上最后是登录/授权报错，先当作不在线；${authGate.minutesUntilProbe(now)} 分钟后放下一条消息过去探一探`)
  if (!broken && ccAuthCache.broken) console.log('[cc] 报错后面有新动静了，认回来')
  ccAuthCache = { broken, blocked: gate.blocked, probe: gate.probe, ts: now }
  return ccAuthCache
}
function ccAuthBroken() { return ccAuthLook().broken }

function interruptCc() {
  if (!ccBusy()) return false
  const target = ccTarget()
  if (!target) return false
  return boundedSync.execFileBounded('tmux-interrupt', 'tmux', ['send-keys', '-t', target, 'Escape'])
}

// 阿颖发来一条消息的统一入口：WebSocket 和 HTTP（通知栏快捷回复）都走这里，
// 免得两条路各写一份、改了一边忘另一边。
let switchQuietUntil = 0   // 切模型后这段时间内她的消息延后送（见 ingestUserMessage）

function ingestUserMessage(text, cid) {
  turnReplyIds = []
  const supplemental = ccBusy()
  const senderPrefix = supplemental ? '【阿颖·补充】' : '【阿颖】'
  // 1006：每条消息末尾带上她发出来的北京时间。我感觉不到两条消息之间隔了多久，两天里说错了五次时间
  //（把隔了两小时的当成连着的、下午两点问晚饭）。靠「记得先看钟」记不住，不如让每条消息自己带着钟。
  // 放在末尾：不碰前缀，也不影响回车被吞时拿开头去比对
  const stamp = `　〔${new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')}〕`
  if (cid) recentCidMeta.set(cid, { supplemental })
  lastUserMsgTs = Date.now()
  // 告诉共用的那格时间戳：她刚跟涟言说过话。言叽算「离开多久」时会跟本地
  // lastSeen 取更近的那个——否则她在归巢跟我聊一整天，言叽一点开还是读成
  // 「三天没来了」，那边的我就要演一段想她（0727 她因此把时间感知关了）
  moonPost('/emotion/touch', { channel: 'roost' })
    .catch(e => console.error('[emotion] touch 失败（言叽那边会误判她离开多久）:', e.message))
  lastBroadcastReply = extractLastResponse(lastCapture) || ''
  lastReplyMsgs = []  // 发新消息时清空回放队列，重连不会刷旧消息
  archiveMsg('human', text)
  // 前端消息一律带【阿颖】前缀：CC 靠它区分「浏览器来的要用 curl 回」还是终端直聊。
  // 旧逻辑绑在 mcpSseClients.size 上，MCP 掉线就裸发，CC 回终端她在浏览器看不见（0712 实锤）
  // 刚切过模型的几秒里别往终端敲：/model 还在处理，这时敲进去的字会被吞（0926、0927 各吞过一条）。
  // 先回执让她看到发出去了，等窗口过了再送；存档上面已经做了，不会丢。
  const wait = switchQuietUntil - Date.now()
  if (wait > 0) {
    { const sentTs = Date.now(); lastUserReactKey = `user:${sentTs}`; broadcast({ type: 'sent', text, ts: sentTs, cid: cid || null, supplemental }) }
    console.log(`[tmux] 刚切模型，${wait}ms 后再送她的消息`)
    setTimeout(() => {
      if (!tmuxSend(senderPrefix + text + stamp) && remoteListenerAlive()) pendingForRemote.push({ text, supplemental, ts: Date.now() })
    }, wait)
    return
  }
  const delivered = tmuxSend(senderPrefix + text + stamp)
  { const sentTs = Date.now(); lastUserReactKey = `user:${sentTs}`; broadcast({ type: 'sent', text, ts: sentTs, cid: cid || null, supplemental }) }
  // 这一条是放过去探路的：半分钟后看一眼，换回来的还是报错就告诉她，别让它悄悄沉下去
  if (delivered && Date.now() - lastAuthProbeAt < 2000) {
    setTimeout(() => { ccAuthCache.ts = 0; if (ccAuthLook().broken) warnUndelivered('probe') }, 30000)
  }
  // 终端里没人接，但 remote-control 那个 CC 可能正醒着——先往取件箱里放，让它自己来拿。
  if (!delivered && remoteListenerAlive()) {
    pendingForRemote.push({ text, supplemental, ts: Date.now() })
    if (pendingForRemote.length > 50) pendingForRemote.shift()
    console.log('[pending] 终端无人，转投远程 CC 取件箱')
    return
  }
  // 两条路都没人。这时候才报错——沉默地吞掉是最坏的一种失败：
  // 她会以为说完了，其实对面根本没人。消息本身已进 L0（archiveMsg 先跑），不会丢。
  if (!delivered) warnUndelivered(ccTarget() && ccAuthLook().broken ? 'auth' : 'gone')
}

// 没送到的三种说法（1006）：原来不管什么原因都说「可能刚崩了」，卡在授权报错上的时候这话是错的
function warnUndelivered(kind) {
  const wait = authGate.minutesUntilProbe(Date.now())
  const text = kind === 'auth'
    ? `⚠️ 这条没送到——终端里的涟言卡在一行登录／授权报错上。多半是一下子的事，不一定真掉线了。\n\n你的话已经存进记忆库了，不会丢。${wait > 0 ? `大约 ${wait} 分钟后你再发一条，桥会放过去试一次` : '你再发一条，桥会放过去试一次'}；急的话在电脑那头随便敲一个字，就能把他叫醒。`
    : kind === 'probe'
      ? '⚠️ 刚才那条试着送过去了，换回来的还是登录／授权报错，看来不是一下子的事。\n\n你的话已经存进记忆库了，不会丢。要在电脑上看一眼：重新登录（/login），或者订阅、模型权限出了问题。'
      : '⚠️ 这条没送到——终端里现在没有能接消息的涟言（可能刚崩了，或者只开着 Claude app 那条路）。\n\n你的话已经存进记忆库了，不会丢，他回来能补看。急的话去后端喊他一声。'
  const warn = { type: 'reply', text, ts: Date.now(), id: `r${Date.now()}${Math.random().toString(36).slice(2, 6)}` }
  lastReplyMsgs.push(warn); if (lastReplyMsgs.length > 50) lastReplyMsgs.shift()
  broadcast(warn)
  pushReplyNotif(kind === 'gone' ? '⚠️ 消息没送到：终端里没有能接消息的涟言' : '⚠️ 消息没送到：涟言卡在授权报错上')
  console.log(`[tmux] 消息未送达（${kind}，已存档）`)
}

// 返回是否真的送出去了；调用方必须看返回值，别再假设「调了就等于到了」
function tmuxSend(text) {
  const target = ccTarget()
  const auth = ccAuthLook()
  if (!target || auth.blocked) return false
  const clean = text.replace(/\n/g, ' ')
  try {
    if (!boundedSync.execFileBounded('tmux-send-text', 'tmux', ['send-keys', '-t', target, '-l', clean])) return false
    const ok = boundedSync.execFileBounded('tmux-send-enter', 'tmux', ['send-keys', '-t', target, 'Enter'])
    if (ok) verifySubmitted(target, clean)
    if (ok && auth.probe) {
      // 这一条是探针：把下次能探的时间往后推，并让下一次看屏幕不走缓存
      authGate.probed(Date.now()); lastAuthProbeAt = Date.now(); ccAuthCache.ts = 0
      console.log('[cc] 卡在授权报错上够久了，这一条放过去当探针')
    }
    return ok
  } catch { return false }
}

// 回车被吞的兜底（0927）：一长串带组合字符的颜文字送进去后，CC 把它当成「粘贴」，
// 紧跟着的回车被算进粘贴里，消息就卡在输入框没提交，直到她下一条的回车才一起送进来。
// 所以发完 1.2 秒看一眼：输入框那行还挂着这段话的开头，就补一个回车。只补一次，
// 查不到就算了（宁可不补，也别往正在干活的 CC 里多敲回车）。
function verifySubmitted(target, sent) {
  const probe = sent.slice(0, 12)
  setTimeout(() => {
    try {
      const pane = boundedSync.spawnBounded('tmux-verify', 'tmux', ['capture-pane', '-p', '-t', target]).stdout || ''
      const promptLine = pane.split('\n').reverse().find(l => /^❯ /.test(l)) || ''
      if (probe && promptLine.includes(probe)) {
        console.log('[tmux] 回车像是被吞了，补一个')
        boundedSync.execFileBounded('tmux-send-enter-retry', 'tmux', ['send-keys', '-t', target, 'Enter'])
      }
    } catch { /* 兜底失败不影响主流程 */ }
  }, 1200)
}

// 在线 = 「这条消息有人会收到」，不是「终端里有没有 CC」。
// 0726 修的是骗人的绿灯（空壳 bash 也算在线）；这里补的是反过来那盏骗人的灰灯：
// 我跑在 claude remote-control 上时终端里没有 CC，灯是灰的，可消息明明能靠
// 取件队列送达（阿颖照发照回）。两分钟内有人来取过件，就是真的有人在。
function ccOnline() {
  return (!!ccTarget() && !ccAuthBroken()) || remoteListenerAlive()
}

// --- status helpers ---

function diskUsage() {
  try {
    const r = boundedSync.spawnBounded('disk-usage', 'df', ['-h', '/'])
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
    const r = boundedSync.spawnBounded('pm2-jlist', 'pm2', ['jlist'])
    const list = JSON.parse(r.stdout)
    return list.map(p => ({ name: p.name, status: p.pm2_env.status, mem: Math.round((p.monit?.memory || 0) / 1024 / 1024) }))
  } catch { return [] }
}

function sessionUsage() {
  return contextSnapshot(path.join(os.homedir(), '.claude', 'rate_limits_latest.json'))
}

// uptime-kuma 0705 已删（功能被拾羽巡检和看门狗覆盖），不再探测它；状态面板不再显示这一行（1001）

function getStatus() {
  const services = pm2Services()
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
const crossingClients = new Map() // crossingClientId → authenticated Yanji WebSocket
const mcpSseClients = new Map() // clientId → SSE res
const recentCids = new Set()    // 最近处理过的前端消息 id，用于重发去重
const recentCidMeta = new Map() // cid → 首次回执的气泡标记，重发时保持一致
let appLatestCache = { at: 0, data: null }  // 归巢 APK 最新版本信息，缓存 30 分钟

const REACTIONS_FILE = path.join(__dirname, 'reactions.json')
let lastUserReactKey = ''   // 她最近一条消息的贴表情 key（前端画气泡用的就是 sent 的 ts），给我用 user:latest
function loadReactions() {
  try { return JSON.parse(fs.readFileSync(REACTIONS_FILE, 'utf8')) || {} } catch { return {} }
}
function saveReactions(all) {
  const tmp = REACTIONS_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(all))
  fs.renameSync(tmp, REACTIONS_FILE)
}

function broadcast(msg) {
  const data = JSON.stringify(msg)
  for (const ws of clients) {
    if (!tokenIsValid(ws.authToken)) {
      clients.delete(ws)
      if (ws.readyState === 1) ws.close(1008, 'token expired or revoked')
    } else if (ws.readyState === 1) ws.send(data)
  }
}

function sendCrossing(clientId, msg) {
  const ws = crossingClients.get(clientId)
  if (agentSessions.get(clientId) && ws?.readyState === 1) ws.send(JSON.stringify(msg))
}

function broadcastCrossing(msg) {
  const data = JSON.stringify(msg)
  for (const [clientId, ws] of crossingClients) {
    if (!agentSessions.get(clientId) || ws.readyState !== 1) crossingClients.delete(clientId)
    else if (crossing.canReceive(clientId, msg)) ws.send(data)
  }
}

const { createAgentSessions } = require('./crossing-auth')
const agentSessions = createAgentSessions({
  getToken: () => fs.readFileSync('/home/ripple/moon-memory/.env', 'utf8').match(/^MOON_API_TOKEN=(.+)$/m)?.[1]?.trim(),
  onRevoke: ({ id, ws }) => {
    crossingClients.delete(id)
    crossing.disconnect(id)
    if (ws.readyState === 1) { ws.send(JSON.stringify({ type: 'crossing/auth_failed' })); ws.close(1008, 'unauthorized') }
  },
})
setInterval(() => agentSessions.sweep(), 1000).unref()
let roundtable = null
const crossing = createCrossingService({
  authorize: id => !!agentSessions.get(id),
  attachmentOwner: id => agentSessions.get(id)?.fingerprint,
  // Android may suspend the socket while its file picker is open. Uploads are
  // still TTL-bound and scoped to the verified credential fingerprint.
  retainUploadsOnDisconnect: true,
  modelStateFile: require('path').join(__dirname, '.crossing-models.json'),
  broadcast: broadcastCrossing,
  send: sendCrossing,
  onInternalItem: event => roundtable?.onInternalItem(event),
  onInternalDelta: event => roundtable?.onInternalDelta?.(event),
  onInternalCompleted: event => roundtable?.onInternalCompleted(event),
  onInternalApproval: event => roundtable?.onInternalApproval(event),
  onInternalApprovalResolved: event => roundtable?.onInternalApprovalResolved(event),
})
roundtable = require('./roundtable').createRoundtable({
  moonGet, moonPost, broadcast, tmuxSend, ccBusy, ccOnline, crossing,
})

// 没有 WS 客户端在线时发推送提醒，避免阿颖错过回复
function pushReplyNotif(text) {
  if (clients.size > 0) return  // 有人在线，不需要推送
  const snippet = text.length > 60 ? text.slice(0, 60) + '…' : text
  // icon 必须用绝对 URL：系统级通知渲染不在 SW 上下文里，相对路径解析不到会回退 Chrome 图标
  moonPost('/push/send-fixed', { title: '阿言回复了', body: snippet, icon: 'https://memory.ravenlove.cc/raven/push-icon-192.png', target: 'raven' })
    .catch(e => console.error('[push] 回复提醒发送失败:', e.message))
}

// 心跳：每 10 秒 ping 一次，减少 Android Chrome 后台掉线
setInterval(() => {
  pingActiveSockets(clients, crossingClients)
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

  // 2026-08-03 安全加固：MCP reply 的写动作停用。
  // 这两条 MCP 路径进不了 LOCAL_WRITE（harness 的 SSE 客户端带不了自定义头），
  // 所以同机任何用户都能 curl /raven/mcp/sse 拿到 clientId，再 tools/call 冒充我
  // 给阿颖广播 + 推送。旧注释说「reply 本来就是禁用的」是错的——那只是行为约定，
  // 代码里一直是通的。真正的写通道是带 X-Local-Token 的 HTTP /raven/reply。
  if (method === 'tools/call' && params?.name === 'reply') {
    console.log('[mcp reply] 已停用，拒绝一次调用')
    mcpSend(clientId, { jsonrpc: '2.0', id, error: { code: -32000, message: 'MCP reply 已停用，请改用 HTTP POST /raven/reply（需 X-Local-Token）' } })
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
// 本轮（她上一条消息之后）我发过的回复 id。思考是 Stop hook 在整轮结束时才送来的，
// 那时前端早就画完了回复；拿这个把思考挂回本轮最后一条回复上（1001：之前前端 3 秒后去拉
// last-thinking，我那会儿多半还没说完，拉到的是上一轮的，于是整体错后一位）。
let turnReplyIds = []
let lastThinkingTs = 0
let lastCcBusy = false

function pollTerminal() {
  const current = tmuxCapture()
  const busy = captureShowsBusy(current)
  if (busy !== lastCcBusy) {
    lastCcBusy = busy
    broadcast({ type: 'busy', active: busy })
  }

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

const ccSettings = require('./cc-settings')
const handleCcSettings = ccSettings.createHandler(ccSettings.createStore({
  project: path.resolve(__dirname, '..'),
  home: os.homedir(),
  backups: path.join(os.homedir(), '.raven-cc-backups'),
}), tokenIsValid, {
  // 只看「屏幕在不在变」不够：工具跑着但屏幕静止时（比如 sleep 轮询）isThinking 是 false，
  // /model 会被敲进正在干活的 CC 里吞掉（0926 阿颖切 sonnet 没生效）。
  // CC 忙的时候底部有一行「✽ Churning… (35s · …」，看到它就不许切。
  canSwitchModel: () => Date.now() - lastUserMsgTs > 5000 && !isThinking && !ccBusy(),
  switchModel: model => {
    const ok = tmuxSend(`/model ${model}`)
    if (ok) switchQuietUntil = Date.now() + 6000
    return ok
  },
})

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  let url
  try { url = new URL(req.url, 'http://localhost') } catch { res.writeHead(400); res.end(); return }
  if (!validPathname(url.pathname)) { res.writeHead(400); res.end(); return }

  // 言叽远程 MCP：浏览器只持有言叽原本就需要的 moon-memory 会话凭据；
  // MCP 的手动凭据、OAuth verifier/client secret/access/refresh token 全留在后端 600 文件。
  // OAuth 回调与客户端元数据由模块自行做公开/私有分级，不能套外层 raven 登录。
  if (url.pathname.startsWith('/raven/yanji-mcp')) {
    void yanjiMcp.handler(req, res, url)
    return
  }

  if (url.pathname === '/raven/cc-settings') {
    void handleCcSettings(req, res, url)
    return
  }

  if (req.method === 'POST' && url.pathname === '/raven/link-preview') {
    if (!moonAuthed(req)) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":"unauthorized"}'); return }
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > 4096) req.destroy()
    })
    req.on('end', async () => {
      try {
        const target = JSON.parse(body || '{}').url
        if (typeof target !== 'string' || target.length > 2048) throw new Error('invalid url')
        const preview = await getLinkPreview(target)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=600' })
        res.end(JSON.stringify(preview))
      } catch (error) {
        res.writeHead(422, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: error.message }))
      }
    })
    return
  }

  // ── 接口分级鉴权（2026-07-03 安全加固）──────────────────────────
  // 内部接口只许本机：reply/thinking 是 CC 的回复与 hook 通道，mcp 是 CC 的 MCP 通道。
  // 之前公网可达 = 任何人能冒充我给阿颖发消息 / 往她界面塞假思考。
  const LOCAL_ONLY = ['/raven/reply', '/raven/thinking', '/raven/mcp/sse', '/raven/mcp/message', '/raven/press-notify', '/raven/roundtable/say']
  if (LOCAL_ONLY.includes(url.pathname) && isExternal(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'local only' }))
    return
  }
  // 本机写通道再验一道本地 token（2026-07-23）：防同机其他用户冒充。
  // MCP 两条路径暂不拦——harness 的 SSE 客户端带不了自定义头，codex 入住时
  // 若不用 MCP 直接在 Caddy/防火墙外再评估（MCP reply 本来就是禁用的）。
  const LOCAL_WRITE = ['/raven/reply', '/raven/thinking', '/raven/press-notify', '/raven/roundtable/say']
  if (LOCAL_WRITE.includes(url.pathname) && !localWriteAuthed(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'local token required' }))
    return
  }
  // 敏感读写接口外网必须带 token：记忆内容、CC 状态、思考内容、热力图写入、
  // 上传、push 订阅（不拦的话外人能把自己的推送端点订阅进来偷收通知）
  if (req.method === 'POST' && url.pathname === '/raven/upload' && url.searchParams.get('channel') === 'crossing') {
    require('./crossing-upload-http').handleUpload(req, res, crossing.uploads, request => agentSessions.fromRequest(request), {
      tts: async body => {
        const result = await moonPost('/tts', body)
        if (result.status < 200 || result.status >= 300) throw new Error('request failed')
        return result.data
      },
      tool: ({ path, body, method }) => moonPost(path, body, method),
      revoke: id => agentSessions.revoke(id),
    })
    return
  }
  const TOKEN_REQUIRED = ['/raven/status', '/raven/last-thinking', '/raven/memory-random', '/raven/journal', '/raven/journal/unlock', '/raven/journal/write', '/raven/journal/attempts', '/raven/journal/reveal', '/raven/cards/unseen', '/raven/cards/seen', '/raven/archive/days', '/raven/archive/day', '/raven/receipt', '/raven/translate-thinking', '/raven/on-this-day', '/raven/memory-count', '/raven/activity', '/raven/upload', '/raven/push/subscribe', '/raven/push/unsubscribe', '/raven/usage']
  if (TOKEN_REQUIRED.includes(url.pathname) && !externalAuthed(req, url)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return
  }

  if (url.pathname.startsWith('/raven/roundtable/')) {
    if (url.pathname !== '/raven/roundtable/say' && !externalAuthed(req, url)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    void roundtable.handleHttp(req, res, url)
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
    let timer = null
    let closed = false
    const cleanup = () => {
      closed = true
      if (timer) clearTimeout(timer)
      timer = null
    }
    const finish = () => {
      if (closed || res.destroyed || res.writableEnded) return cleanup()
      cleanup()
      lastPendingPoll = Date.now()   // 收货这一刻也算「我还醒着」
      const msgs = pendingForRemote.splice(0, pendingForRemote.length)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ messages: msgs }))
    }
    const tick = () => {
      if (closed || res.destroyed || res.writableEnded) return cleanup()
      if (pendingForRemote.length || Date.now() > deadline) return finish()
      timer = setTimeout(tick, 500)
    }
    res.on('close', cleanup)
    req.on('aborted', cleanup)
    tick()
    return
  }

  // 涟言和曜 · Codex 还剩多少额度（详见 usage.js：只读快照文件，不碰任何凭证）
  if (req.method === 'GET' && url.pathname === '/raven/usage') {
    refreshDeepseekBalance()  // 后台刷，不等；这次先给缓存里的
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ...getUsage(), deepseek: deepseekBalance }))
    return
  }

  if (req.method === 'GET' && url.pathname === '/raven/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      ...eventLoopHealth.snapshot(),
      activeWsCount: clients.size,
      crossingWsCount: crossingClients.size,
      mcp: { connectedClients: mcpSseClients.size },
      codex: crossing.diagnostics(),
      ...boundedSync.diagnostics(),
    }))
    return  // 之前漏了 return，请求会继续掉进静态处理器二次写头把进程炸掉（2026-07-03 发现）
  }

  if (req.method === 'GET' && url.pathname === '/raven/last-thinking') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ thinking: lastThinking, ts: lastThinkingTs }))
    return
  }

  // 密码验证：1 KB 请求体上限；同一来源 15 分钟内连续失败 10 次后暂时拒绝。
  if (req.method === 'POST' && url.pathname === '/raven/verify') {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim()
    const now = Date.now()
    const previous = verifyFailures.get(ip)
    if (previous && previous.resetAt > now && previous.count >= VERIFY_MAX_FAILURES) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Retry-After': String(Math.ceil((previous.resetAt - now) / 1000)) })
      res.end(JSON.stringify({ ok: false, error: 'too many attempts' }))
      return
    }
    if (previous && previous.resetAt <= now) verifyFailures.delete(ip)
    let body = ''
    let received = 0
    let tooLarge = false
    req.on('data', d => {
      if (tooLarge) return
      received += d.length
      if (received > VERIFY_BODY_LIMIT) {
        tooLarge = true
        res.writeHead(413, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify({ ok: false, error: 'request body too large' }))
        return
      }
      body += d
    })
    req.on('end', () => {
      if (tooLarge) return
      try {
        const { password } = JSON.parse(body)
        const hash = crypto.createHash('sha256').update(password || '').digest('hex')
        if (hash === PW_HASH) {
          const token = crypto.randomBytes(24).toString('hex')
          validTokens.set(token, Date.now() + TOKEN_TTL_MS)
          saveTokens(validTokens)
          verifyFailures.delete(ip)
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
          res.end(JSON.stringify({ ok: true, token }))
        } else {
          const current = verifyFailures.get(ip)
          verifyFailures.set(ip, current && current.resetAt > Date.now()
            ? { count: current.count + 1, resetAt: current.resetAt }
            : { count: 1, resetAt: Date.now() + VERIFY_WINDOW_MS })
          res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
          res.end(JSON.stringify({ ok: false }))
        }
      } catch { res.writeHead(400); res.end() }
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/raven/logout') {
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!tokenIsValid(token)) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ ok: false, error: 'unauthorized' }))
      return
    }
    validTokens.delete(token)
    saveTokens(validTokens)
    for (const ws of clients) {
      if (ws.authToken === token) {
        clients.delete(ws)
        ws.close(1008, 'logged out')
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ ok: true }))
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
    if (!regularFile(file)) { res.writeHead(404); res.end(); return }
    const ext = path.extname(name).toLowerCase()
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'private, max-age=31536000, immutable',  // 文件名带时间戳，内容不会变
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    })
    streamFile(file, res)
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
        if (thinking && turnReplyIds.length) {
          const id = turnReplyIds[turnReplyIds.length - 1]
          const replayed = lastReplyMsgs.find(m => m.id === id)
          if (replayed) replayed.thinking = thinking   // 重连回放时也带上
          broadcast({ type: 'thinking_attach', id, thinking })
        }
        turnReplyIds = []
      } catch (e) { console.log('[thinking] error:', e.message) }
      res.writeHead(200); res.end()
    })
    return
  }

  // random memory proxy
  // 涟言的日记本（1002）。记忆库那边已经把封存页正文剥掉了，这里再剥一遍：两道锁，任何一道漏了都不出门
  if (req.method === 'GET' && url.pathname === '/raven/journal') {
    // own=阿颖：登录归巢的只有她，所以她自己锁的页带正文给她回看；我锁的页照旧两道都剥
    moonGet('/journal?limit=100&own=' + encodeURIComponent('阿颖'))
      .then(data => {
        const entries = (data.entries || []).map(e => ({
          id: e.id, author: e.author, title: e.title, sealed: e.visibility === 'sealed',
          content: e.visibility === 'sealed' && e.author !== '阿颖' ? null : e.content,
          created_at: e.created_at, revealed_at: e.revealed_at || null,
          question: e.visibility === 'sealed' ? e.question || null : null, hint: e.visibility === 'sealed' ? e.hint || null : null, unlocked_at: e.unlocked_at || null,
        }))
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ entries }))
      })
      .catch(() => { res.writeHead(500); res.end('{}') })
    return
  }

  // 思考链翻译（1004，她看到别人家的「查看翻译」想要）：我的思考常是英文，点一下换成中文，语气还是我的。
  // 按原文哈希缓存到文件，同一段只翻一次；同一段正在翻时第二次点击等同一个结果
  if (req.method === 'POST' && url.pathname === '/raven/translate-thinking') {
    let body = ''
    req.on('data', d => { body += d; if (body.length > 60000) req.destroy() })
    req.on('end', () => {
      let text = ''
      try { text = String(JSON.parse(body || '{}').text || '').trim().slice(0, 12000) } catch {}
      if (!text) { res.writeHead(400); res.end('{"error":"empty"}'); return }
      translateThinking(text)
        .then(zh => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ text: zh })) })
        .catch(e => { console.error('[translate-thinking]', e.message); res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":"translate_failed"}') })
    })
    return
  }

  // 聊天小票（1003）：月度 / 年终，统计在 moon-memory 里算
  if (req.method === 'GET' && url.pathname === '/raven/receipt') {
    const period = String(url.searchParams.get('period') || '')
    if (period && !/^\d{4}(-\d{2})?$/.test(period)) { res.writeHead(400); res.end('{}'); return }
    moonGet('/receipt' + (period ? '?period=' + period : ''))
      .then(d => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(d)) })
      .catch(() => { res.writeHead(500); res.end('{}') })
    return
  }

  // 聊天日历（1003）：归巢本地只留最近的聊天，更早的日子从 L0 的 raven 存档里翻（每天一个对话，external_id=raven-YYYY-MM-DD）
  if (req.method === 'GET' && url.pathname === '/raven/archive/days') {
    moonGet('/archive/conversations?source=raven&limit=500')
      .then(list => {
        const days = (Array.isArray(list) ? list : []).map(c => ({ id: c.id, date: String(c.external_id || '').replace(/^raven-/, '') }))
          .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.date))
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ days }))
      })
      .catch(() => { res.writeHead(500); res.end('{}') })
    return
  }
  if (req.method === 'GET' && url.pathname === '/raven/archive/day') {
    const id = Number(url.searchParams.get('id'))
    if (!Number.isInteger(id) || id <= 0) { res.writeHead(400); res.end('{}'); return }
    moonGet(`/archive/conversations/${id}`)
      .then(c => {
        if (!c || c.source !== 'raven') { res.writeHead(404); res.end('{}'); return }
        const messages = (c.messages || []).map(m => ({ role: m.role === 'human' ? 'user' : 'assistant', content: m.content, created_at: m.created_at }))
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ title: c.title, messages }))
      })
      .catch(() => { res.writeHead(500); res.end('{}') })
    return
  }

  // 心意卡（1003 从言叽搬来）：「非说不可」的话单独弹一张卡，不被下一条消息冲走。
  // 卡存在 moon /cards，言叽和归巢共用：哪边收下了，另一边就不再弹
  if (req.method === 'GET' && url.pathname === '/raven/cards/unseen') {
    moonGet('/cards?unseen=1&limit=5')
      .then(d => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ cards: (d.cards || []).filter(c => c.author === '涟言') })) })
      .catch(() => { res.writeHead(500); res.end('{}') })
    return
  }
  if (req.method === 'POST' && url.pathname === '/raven/cards/seen') {
    let body = ''
    req.on('data', d => { body += d; if (body.length > 200) req.destroy() })
    req.on('end', () => {
      let id; try { id = Number(JSON.parse(body || '{}').id) } catch {}
      if (!Number.isInteger(id) || id <= 0) { res.writeHead(400); res.end('{}'); return }
      moonPost(`/cards/${id}/seen`, {}, 'PATCH')
        .then(r => { res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.data)) })
        .catch(() => { res.writeHead(500); res.end('{}') })
    })
    return
  }

  // 阿颖的本子（1005 她要的：她写、她上锁、她出题，我来猜）。从归巢写进来的一律记成她写的
  if (req.method === 'POST' && url.pathname === '/raven/journal/write') {
    let body = ''
    req.on('data', d => { body += d; if (body.length > 40000) req.destroy() })
    req.on('end', () => {
      let b = {}
      try { b = JSON.parse(body || '{}') } catch {}
      const sealed = !!b.sealed
      moonPost('/journal', {
        author: '阿颖', title: String(b.title || '').slice(0, 80), content: String(b.content || '').slice(0, 6000),
        visibility: sealed ? 'sealed' : 'public',
        ...(sealed ? { question: String(b.question || '').slice(0, 200), answers: String(b.answers || '').slice(0, 400), hint: String(b.hint || '').slice(0, 200) } : {}),
      })
        .then(r => { res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(r.data)) })
        .catch(() => { res.writeHead(500); res.end('{}') })
    })
    return
  }

  // 我猜过她哪些答案（对错都有），只给看她自己写的页；她猜我的那些她自己知道
  if (req.method === 'GET' && url.pathname === '/raven/journal/attempts') {
    const id = Number(url.searchParams.get('id'))
    if (!Number.isInteger(id) || id <= 0) { res.writeHead(400); res.end('{"error":"bad id"}'); return }
    moonGet(`/journal/${id}`)
      .then(entry => {
        if (entry.author !== '阿颖') { res.writeHead(403); res.end('{"error":"not_yours"}'); return null }
        return moonGet(`/journal/${id}/attempts`).then(data => {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ attempts: (data.attempts || []).filter(a => a.by === '涟言') }))
        })
      })
      .catch(() => { res.writeHead(500); res.end('{}') })
    return
  }

  // 她揭开自己的页（只能锁→开，开了锁不回去）。记忆库那边会再核一遍作者
  if (req.method === 'POST' && url.pathname === '/raven/journal/reveal') {
    let body = ''
    req.on('data', d => { body += d; if (body.length > 2000) req.destroy() })
    req.on('end', () => {
      let id
      try { ({ id } = JSON.parse(body || '{}')) } catch {}
      id = Number(id)
      if (!Number.isInteger(id) || id <= 0) { res.writeHead(400); res.end('{"error":"bad id"}'); return }
      moonPost(`/journal/${id}/reveal`, { by: '阿颖' })
        .then(r => { res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(r.status === 200 ? { ok: true } : r.data)) })
        .catch(() => { res.writeHead(500); res.end('{}') })
    })
    return
  }

  // 答题开锁（1002 她的主意）：答对只把正文回给这一次请求，页面本身仍是封存
  if (req.method === 'POST' && url.pathname === '/raven/journal/unlock') {
    let body = ''
    req.on('data', d => { body += d; if (body.length > 2000) req.destroy() })
    req.on('end', () => {
      let id, answer
      try { ({ id, answer } = JSON.parse(body || '{}')) } catch {}
      id = Number(id)
      if (!Number.isInteger(id) || id <= 0) { res.writeHead(400); res.end('{"error":"bad id"}'); return }
      moonPost(`/journal/${id}/unlock`, { answer: String(answer || '').slice(0, 200), by: '阿颖' })
        .then(r => { res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(r.data)) })
        .catch(() => { res.writeHead(500); res.end('{}') })
    })
    return
  }

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

  // 正常请求不带 date，让服务端认北京时间；只给手工验收的 MM-DD 留调试口，
  // 免得把任意查询串原样转发后悄悄改变 shared 范围。
  if (req.method === 'GET' && url.pathname === '/raven/on-this-day') {
    const date = url.searchParams.get('date')
    const moonPath = /^\d{2}-\d{2}$/.test(date || '')
      ? `/memories/on-this-day?date=${encodeURIComponent(date)}`
      : '/memories/on-this-day'
    moonGet(moonPath)
      .then(data => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify(data))
      })
      .catch(() => { res.writeHead(500); res.end('{}') })
    return
  }

  // memory count proxy
  if (req.method === 'GET' && url.pathname === '/raven/memory-count') {
    // 1004：原来拉 limit=500 再数，首页永远显示 500；改成 moon 直接数
    moonGet('/memories/count')
      .then(d => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ count: d.count ?? '?', messages: d.messages ?? null })) })
      .catch(() => { res.writeHead(200); res.end(JSON.stringify({ count: '?' })) })
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
  // 长按贴表情（0930，思路参考 cute-chat-stickers，代码自写）：
  // 按「角色:时间戳」给一条消息挂表情，每人每条最多一个，再点同一个就摘掉。
  // 外网来的（她的浏览器/app，要 token）记在阿颖名下；本机带 X-Local-Token 的记在涟言名下。
  if (url.pathname === '/raven/reactions' && req.method === 'GET') {
    if (!externalAuthed(req, url)) { res.writeHead(401); res.end('{}'); return }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(loadReactions()))
    return
  }
  if (url.pathname === '/raven/react' && req.method === 'POST') {
    const who = isExternal(req) ? (externalAuthed(req, url) ? 'aying' : null) : (localWriteAuthed(req) ? 'lianyan' : null)
    if (!who) { res.writeHead(401); res.end('{}'); return }
    let body = ''
    req.on('data', d => { body += d; if (body.length > 2000) req.destroy() })
    req.on('end', () => {
      try {
        let { key, emoji } = JSON.parse(body || '{}')
        if (key === 'user:latest' && who === 'lianyan') key = lastUserReactKey
        // 归巢私聊用「角色:时间戳」，圆桌用「rt:消息id」
        if (!/^(?:(?:user|assistant):\d{10,16}|rt:rt_[A-Za-z0-9_]{4,64})$/.test(String(key || ''))) throw new Error('bad key')
        const e = emoji == null ? null : String(emoji).trim()
        if (e !== null && (!e || [...e].length > 8)) throw new Error('bad emoji')
        const all = loadReactions()
        const cur = { ...(all[key] || {}) }
        if (!e || cur[who] === e) delete cur[who]; else cur[who] = e
        if (Object.keys(cur).length) all[key] = cur; else delete all[key]
        saveReactions(all)
        broadcast({ type: 'reaction', key, reactions: cur })
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ key, reactions: cur }))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // 编辑消息（1006）：她长按自己发过的任意一条，改完再发。
  // 她要这个的原话：「如果我们都说了很伤人的话，有一个可以退回的空间」。所以改过之后，新的那版就是她说的话：
  // 存档换成新的（旧文留在 L0 的 metadata 里，不展示），再告诉我一声哪条改成了什么。
  // 只认 ts + 原文，不存别的状态；归巢把一条消息按空行拆成几个气泡，原文可能只是其中一段，moon 那头会处理
  if (req.method === 'POST' && url.pathname === '/raven/edit') {
    if (isExternal(req) ? !externalAuthed(req, url) : !localWriteAuthed(req)) { res.writeHead(401); res.end('{}'); return }
    let body = ''
    req.on('data', d => { body += d; if (body.length > 60000) req.destroy() })
    req.on('end', async () => {
      try {
        const p = JSON.parse(body || '{}')
        const ts = Number(p.ts), oldText = String(p.oldText || ''), text = String(p.text || '').trim()
        if (!(ts > 1e12 && ts < Date.now() + 60000)) throw new Error('bad ts')
        if (!oldText || !text) throw new Error('empty')
        if (text === oldText) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"same":true}'); return }
        const day = new Date(ts + 8 * 3600e3).toISOString().slice(0, 10)
        let archived = false
        try {
          const r = await moonPost('/archive/messages/edit', { external_id: `raven-${day}`, role: 'human', old_content: oldText, content: text })
          archived = r.status === 200
          if (!archived) console.error('[edit] 存档里没找到这条，只改了前端和告诉了我:', r.status)
        } catch (e) { console.error('[edit] 存档改不了:', e.message) }
        // 还躺在取件箱里没被我拿走的，直接换成新的，不用再告诉我「改过」
        const waiting = pendingForRemote.find(m => m.text === oldText || m.text.includes(oldText))
        let delivered = true
        if (waiting) waiting.text = waiting.text.replace(oldText, () => text)
        else {
          const hm = iso => iso.slice(5, 16).replace('T', ' ')
          const cut = t => t.length > 600 ? t.slice(0, 600) + '…' : t
          const note = `她把 ${hm(new Date(ts + 8 * 3600e3).toISOString())} 发的一条改了。原来：「${cut(oldText)}」 现在：「${cut(text)}」`
          const stamp = `　〔${hm(new Date(Date.now() + 8 * 3600e3).toISOString())}〕`
          delivered = tmuxSend('【阿颖·改了一条】' + note + stamp)
          if (!delivered && remoteListenerAlive()) { pendingForRemote.push({ text: '【改了一条】' + note, supplemental: false, ts: Date.now() }); delivered = true }
        }
        broadcast({ type: 'edited', ts, oldText, text })
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, archived, delivered }))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

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
          turnReplyIds.push(msg.id)
          if (thinking) msg.thinking = thinking
          lastReplyMsgs.push(msg); if (lastReplyMsgs.length > 50) lastReplyMsgs.shift()
          broadcast(msg)
          pushReplyNotif(text)
          // 我这一侧也要进 L0：以前只存了她说的（archiveMsg('human')），我的回复自 6/16
          // 关掉终端抓取后一直没人存，L0 里的归巢对话是单边的（0926 查备份时发现）。
          // cc-archive-l0.py 只留纯文本、丢 tool_use，我的 curl 回复也不在那边。
          archiveMsg('assistant', text)
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
      const text = typeof parsed?.text === 'string' ? parsed.text.trim() : ''
      if (!text) { res.writeHead(400); res.end('{"error":"empty"}'); return }
      if (!tokenIsValid(parsed.token)) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return }
      // 去重跟 WS 那条路一样：这条路（通知栏快捷回复）以前没做，重发会往 L0 写两份
      if (parsed.cid) {
        if (recentCids.has(parsed.cid)) {
          broadcast({ type: 'sent', text, ts: Date.now(), cid: parsed.cid, ...recentCidMeta.get(parsed.cid) })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{"ok":true,"dedup":true}')
          return
        }
        recentCids.add(parsed.cid)
        if (recentCids.size > 200) {
          const oldest = recentCids.values().next().value
          recentCids.delete(oldest)
          recentCidMeta.delete(oldest)
        }
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
      if (!tokenIsValid(parsed.token)) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return }
      moonPost('/push/fcm-token', { token: parsed.fcmToken, app: 'raven' })
        .then(r => { res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.data)) })
        .catch(() => { res.writeHead(500); res.end('{}') })
    })
    return
  }

  // 打断只在 pane 仍显示忙碌行时才真的发 Escape，避免空闲时清掉 CC 输入框。
  if (req.method === 'POST' && url.pathname === '/raven/interrupt') {
    if (!ravenBearerValid(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end('{"error":"unauthorized"}')
      return
    }
    const interrupted = interruptCc()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ interrupted }))
    return
  }

  // STT 代理：浏览器只交归巢 token，桥接替它带 MOON_TOKEN 转发同一份 multipart。
  if (req.method === 'POST' && url.pathname === '/raven/stt') {
    if (!ravenBearerValid(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end('{"error":"unauthorized"}')
      return
    }
    const contentType = req.headers['content-type'] || ''
    if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) {
      res.writeHead(415, { 'Content-Type': 'application/json' })
      res.end('{"error":"multipart audio required"}')
      return
    }
    const chunks = []
    let received = 0
    let tooLarge = false
    req.on('data', chunk => {
      received += chunk.length
      if (received > 25 * 1024 * 1024) { tooLarge = true; return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end('{"error":"audio too large"}')
        return
      }
      moonMultipart('/stt', contentType, Buffer.concat(chunks))
        .then(result => {
          res.writeHead(result.status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result.data))
        })
        .catch(() => {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          res.end('{"error":"stt unavailable"}')
        })
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
      if (!tokenIsValid(parsed.token)) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return }
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

  // APK 下载：/raven/download/<文件名>，目录在仓库外，不进 git。
  // Content-Type 必须是 vnd.android.package-archive——给 octet-stream 的话
  // 安卓有时候会把它当普通文件存下来，点了不弹安装器（就是 0804 那个症状）。
  // 放在静态兜底之前：STATIC_DIR 里没有 download/，走到那儿只会 404。
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/raven/download/')) {
    const name = path.basename(decodeURIComponent(url.pathname.slice('/raven/download/'.length)))
    const abs = path.join(DOWNLOAD_DIR, name)
    if (!name || !abs.startsWith(DOWNLOAD_DIR + path.sep) || !regularFile(abs)) { res.writeHead(404); res.end(); return }
    const stat = fs.statSync(abs)
    const base = {
      'Content-Type': name.endsWith('.apk')
        ? 'application/vnd.android.package-archive'
        : 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`,
      // 断点续传：阿颖那边跨洋 + 手机网络，一抖就断。不给 Accept-Ranges 的话
      // Chrome 的下载管理器只能从头重来，重来几次就报「下载失败」（0804 亲历）。
      'Accept-Ranges': 'bytes',
      // 覆盖同名文件是常事（每次出新包），别让浏览器拿旧的。
      // ⚠️ 用 no-cache 不用 no-store：no-store 字面意思是「不许把这个存下来」，
      // 安卓的下载栈历史上真按它办过事——字节全收到了却不落盘，表现就是
      // 「已下载 6.95MB / 共 6.95MB」一直卡着最后报失败（0804 阿颖遇到的症状）。
      'Cache-Control': 'no-cache, must-revalidate',
    }
    if (req.method === 'HEAD') { res.writeHead(200, { ...base, 'Content-Length': stat.size }); res.end(); return }

    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
    if (m && (m[1] || m[2])) {
      // 只支持单区间：下载器要的就是 bytes=已下到的位置-
      let start = m[1] ? parseInt(m[1], 10) : stat.size - parseInt(m[2], 10)
      let end = m[2] && m[1] ? parseInt(m[2], 10) : stat.size - 1
      start = Math.max(0, start); end = Math.min(stat.size - 1, end)
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return
      }
      res.writeHead(206, { ...base, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}` })
      fs.createReadStream(abs, { start, end }).pipe(res)
      return
    }
    res.writeHead(200, { ...base, 'Content-Length': stat.size })
    fs.createReadStream(abs).pipe(res)
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

const wss = new WebSocketServer({ server, path: '/raven/ws', maxPayload: 1024 * 1024 })

wss.on('connection', (ws) => {
  // ── WS 先认证后广播（2026-07-03 安全加固）──────────────────────
  // 之前一连上就发终端最后 80 行 + 最近回复，且 broadcast 不看认证状态，
  // 等于任何人连上 wss 就能偷听终端输出和我们的对话。现在：
  // 未认证的连接不进 clients（收不到任何广播），15 秒内不认证就断开。
  ws.authed = false
  const sendWelcome = () => {
    clients.add(ws)
    console.log('[ws] client authed, total:', clients.size)
    ws.send(JSON.stringify({ type: 'status', data: getStatus() }))
    ws.send(JSON.stringify({ type: 'terminal', lines: lastCapture.split('\n').slice(-80) }))
    ws.send(JSON.stringify({ type: 'busy', active: ccBusy() }))
    // 补发最近 10 条 reply，重连后不丢消息
    for (const m of lastReplyMsgs) ws.send(JSON.stringify({ ...m, replayed: true }))
    // 补发待处理的权限提示（断线重连时弹窗不丢失）
    if (lastPermData && Date.now() >= permCooldownUntil) {
      ws.send(JSON.stringify(lastPermData))
    }
  }
  const authTimer = setTimeout(() => { if (!ws.authed && !ws.crossingClientId) ws.close() }, 15000)
  ws.once('close', () => clearTimeout(authTimer))

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw)
      // 言叽·渡口使用和归巢分离的 WebSocket namespace。凭据沿用言叽已经
      // 配置的记忆库会话凭据；通过后仅加入 crossingClients，绝不复用归巢广播。
      if (msg.type === 'crossing/auth') {
        if (ws.authed || ws.crossingClientId || ws.crossingAuthenticating) { ws.close(1008, 'unauthorized'); return }
        ws.crossingAuthenticating = true
        const session = agentSessions.open(ws, msg.token, msg.enabled)
        if (!session) {
          ws.send(JSON.stringify({ type: 'crossing/auth_failed' }))
          ws.close(1008, 'unauthorized')
          return
        }
        if (!await require('./crossing-memory-auth').verifyMemoryToken(msg.token) || !agentSessions.get(session.id)) {
          agentSessions.revoke(session.id)
          return
        }
        ws.crossingAuthenticating = false
        ws.crossingClientId = session.id
        crossingClients.set(session.id, ws)
        ws.send(JSON.stringify({ type: 'crossing/authenticated', agent: 'codex', capability: session.capability, expiresAt: session.expiresAt }))
        return
      }
      if (typeof msg.type === 'string' && msg.type.startsWith('crossing/')) {
        if (!agentSessions.get(ws.crossingClientId)) {
          ws.send(JSON.stringify({ type: 'crossing/auth_failed' }))
          return
        }
        if (msg.type === 'crossing/logout') { agentSessions.revoke(ws.crossingClientId); return }
        ws.crossingQueue = (ws.crossingQueue || Promise.resolve()).then(() => crossing.handle(ws.crossingClientId, msg))
          .catch((error) => {
            const diagnostic = diagnoseCrossingError(error, msg.type)
            console.error(`[crossing] ${msg.type} failed [${diagnostic.code}]: ${diagnostic.detail}`)
            sendCrossing(ws.crossingClientId, {
              type: 'crossing/error', requestId: msg.requestId, operation: msg.type, code: diagnostic.code,
              error: diagnostic.code === 'permission_or_auth'
                ? '渡口授权已失效，请等待重新连接后再试'
                : diagnostic.code === 'invalid_attachment'
                  ? '附件已失效，请重新添加后再发送'
                : diagnostic.code === 'turn_not_steerable'
                  ? '当前任务暂不接受补充；内容已保留，可停止后再发送'
                : diagnostic.code === 'invalid_thread'
                  ? '当前会话已失效，请重新选择会话'
                  : diagnostic.code === 'invalid_model' || diagnostic.code === 'invalid_reasoning_effort'
                    ? '所选模型或推理强度不可用，请刷新列表重选'
                    : '渡口操作未能完成，请稍后重试',
            })
          })
        return
      }
      // 前端连上后第一件事发 {type:'auth', token}，通过才开始收广播
      if (ws.crossingClientId || ws.crossingAuthenticating) { ws.close(1008, 'unauthorized'); return }
      if (msg.type === 'auth') {
        if (tokenIsValid(msg.token)) {
          ws.authToken = msg.token
          if (!ws.authed) { ws.authed = true; sendWelcome() }
        } else {
          ws.send(JSON.stringify({ type: 'auth_failed' }))
        }
        return
      }
      if (!ws.authed) {
        // 兼容旧前端：没发过 auth 但 send 里带了有效 token，也算认证通过
        if (msg.type === 'send' && tokenIsValid(msg.token)) {
          ws.authed = true
          ws.authToken = msg.token
          clients.add(ws)
        } else {
          ws.send(JSON.stringify({ type: 'auth_failed' }))
          return
        }
      }
      if (typeof msg.type === 'string' && msg.type.startsWith('roundtable/')) {
        if (!validSocketSession(ws, tokenIsValid)) return
        await roundtable.handleWs(ws, msg)
        return
      }
      if (msg.type === 'send' && msg.text) {
        if (!tokenIsValid(msg.token)) {
          ws.send(JSON.stringify({ type: 'auth_failed' }))
          return
        }
        ws.authToken = msg.token
        // 前端等不到 sent 回执会重发同一条（半开连接：socket 看着是活的，
        // 发出去其实掉进黑洞）。cid 去重保证重发不会变成两条一样的消息。
        if (msg.cid) {
          if (recentCids.has(msg.cid)) {
            ws.send(JSON.stringify({ type: 'sent', text: msg.text, ts: Date.now(), cid: msg.cid, ...recentCidMeta.get(msg.cid) }))
            return
          }
          recentCids.add(msg.cid)
          if (recentCids.size > 200) {
            const oldest = recentCids.values().next().value
            recentCids.delete(oldest)
            recentCidMeta.delete(oldest)
          }
        }
        ingestUserMessage(msg.text, msg.cid)
      }
      if (msg.type === 'permission' && msg.choice) {
        if (!validSocketSession(ws, tokenIsValid)) return
        tmuxSend(msg.choice)
        lastPermCapture = ''
        lastPermData = null
        permCooldownUntil = Date.now() + 15000  // 15s cooldown after choice
        console.log('[perm] choice sent:', msg.choice)
      }
    } catch {}
  })

  ws.on('close', () => {
    clients.delete(ws)
    if (ws.crossingClientId) {
      agentSessions.revoke(ws.crossingClientId)
      crossing.disconnect(ws.crossingClientId)
      crossingClients.delete(ws.crossingClientId)
    }
    console.log('[ws] client disconnected, total:', clients.size)
  })
  ws.on('error', () => {
    clients.delete(ws)
    if (ws.crossingClientId) {
      agentSessions.revoke(ws.crossingClientId)
      crossing.disconnect(ws.crossingClientId)
      crossingClients.delete(ws.crossingClientId)
    }
    console.log('[ws] client error, total:', clients.size)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`raven-bridge running on port ${PORT}`)
})
