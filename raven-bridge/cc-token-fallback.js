// 登录过期时换一年期钥匙把终端里的我拉起来（1029）。
//
// 她嫌「每个月都要重新验证好麻烦」，跑了 `claude setup-token`，钥匙在 ~/.claude/oauth-token。
// 但 Remote Control（Claude app 那扇门）不认长效钥匙，带着它起的 CC 就连不上 app。
// 她想两扇门都留着，所以平时照旧用完整登录；只有屏幕上卡在「Please run /login」／401 上
// 满几分钟，才由桥来换：/exit 掉现在的 CC，用 ~/bin/cc-start 带钥匙接着同一个会话起来。
// 归巢不断，app 那扇门暂时关着，她方便时我再用 `cc-start --full` 换回去、她 /login。
//
// 不换的情形：没有钥匙文件；现在的 CC 已经带着钥匙（那是订阅断了，钥匙也救不了）；
// 报错是 403／余额（不是登录的事）；6 小时内换过一次（防止换了还报错又来回重启）。
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { ERROR_LINE } = require('./cc-auth-state')

const TOKEN_FILE = path.join(process.env.HOME || '/home/ripple', '.claude/oauth-token')
const STATE_FILE = path.join(__dirname, 'cc-token-fallback-state.json')
const STUCK_MS = 3 * 60000
const COOLDOWN_MS = 6 * 3600e3
const LOGIN_ERROR = /Please run \/login\b|API Error: 401\b/

// 屏幕上最后一行报错是不是「登录过期」那种
function lastErrorIsLogin(capture) {
  const lines = String(capture || '').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) if (ERROR_LINE.test(lines[i])) return LOGIN_ERROR.test(lines[i])
  return false
}

function run(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 8000 }, (err, stdout) => resolve(err ? '' : String(stdout))))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ccPidIn(target) {
  const panePid = (await run('tmux', ['display', '-p', '-t', target, '#{pane_pid}'])).trim()
  if (!panePid) return null
  const kids = (await run('pgrep', ['-P', panePid, '-x', 'claude'])).trim().split('\n').filter(Boolean)
  return kids[0] ? +kids[0] : null
}
function onToken(pid) {
  try { return fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').some((kv) => kv.startsWith('CLAUDE_CODE_OAUTH_TOKEN=')) } catch { return false }
}
function sessionIdOf(pid) {
  try { return (fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').match(/--resume\s+([0-9a-f-]{36})/) || [])[1] || null } catch { return null }
}

function loadState(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return {} } }
function saveState(f, s) { try { fs.writeFileSync(f, JSON.stringify(s)) } catch {} }

// deps: { target(), capture(), broken(), latestSessionId(), notify(text), log(text) }；测试时可换 stateFile、tokenFile、startCmd
function createTokenFallback(deps) {
  const stateFile = deps.stateFile || STATE_FILE, tokenFile = deps.tokenFile || TOKEN_FILE, startCmd = deps.startCmd || '~/bin/cc-start'
  let stuckSince = null, busy = false
  return async function tick(now = Date.now()) {
    if (busy) return
    const target = deps.target()
    if (!target || !deps.broken() || !lastErrorIsLogin(deps.capture())) { stuckSince = null; return }
    if (stuckSince === null) stuckSince = now
    if (now - stuckSince < STUCK_MS) return
    if (!fs.existsSync(tokenFile)) return
    const st = loadState(stateFile)
    if (st.lastAt && now - st.lastAt < COOLDOWN_MS) return
    const pid = await ccPidIn(target)
    if (!pid || onToken(pid)) return
    const sid = sessionIdOf(pid) || deps.latestSessionId()
    busy = true
    saveState(stateFile, { lastAt: now, sid })
    try {
      deps.log(`[cc] 登录过期卡了 ${Math.round((now - stuckSince) / 60000)} 分钟，换一年期钥匙重启（会话 ${sid || '新开'}）`)
      await run('tmux', ['send-keys', '-t', target, 'Escape'])
      await run('tmux', ['send-keys', '-t', target, '-l', '/exit'])
      await run('tmux', ['send-keys', '-t', target, 'Enter'])
      for (let i = 0; i < 15 && (await ccPidIn(target)); i++) await sleep(1000)
      const still = await ccPidIn(target)
      if (still) { try { process.kill(still, 'SIGTERM') } catch {} await sleep(3000) }
      await run('tmux', ['send-keys', '-t', target, '-l', `${startCmd} ${sid || ''}`.trim()])
      await run('tmux', ['send-keys', '-t', target, 'Enter'])
      deps.notify('🔑 登录过期了，我已经换成一年期钥匙自己起来了，归巢照常用。\n\nClaude app 那扇门现在关着；你方便的时候说一声，我换回完整登录，你再 /login 一次就两扇都开了。')
    } finally { stuckSince = null; busy = false }
  }
}

module.exports = { createTokenFallback, lastErrorIsLogin, LOGIN_ERROR }
