// 用量面板数据源 —— 归巢 /raven/usage 用
//
// 思路借自 github.com/waterside0219/ai-usage-monitor（MIT），但**没有装它**：
// 它是一个独立的 Python HTTP 服务（另一个端口、另一套 shared secret、另一个开机自启、
// 另一个要巡检和备份的东西）。这台机器 1.9G 内存，能少一个常驻进程就少一个。
// 真正有价值的是它那两个数据源怎么读，那部分不到一百行，搬进归巢就够了。
//
// 两个来源都是「别人写好的快照文件」，这里只读不取钥匙：
//   涟言（Claude Code 订阅额度 + 上下文余量）
//     ← ~/bin/cc-status-capture.py，挂在 CC 的 statusLine 钩子上，CC 每次重画状态栏就刷新
//   小扣（Codex 额度）
//     ← /home/codex/bin/usage-snapshot.py，codex 自己的 cron 每 10 分钟跑一次
//       故意绕这一圈：codex 的 OAuth token 一步都不进 ripple 的进程，共用文件里只有百分比
//
// 所以这个模块本身碰不到任何凭证，最坏情况是读到一份过期的百分比。

const fs = require('fs')

const CLAUDE_FILE = '/home/ripple/.claude/rate_limits_latest.json'
const CODEX_FILE = '/var/lib/ai-usage/codex.json'

// 状态栏只在 CC 活着并重画时刷新；超过这个岁数就标 stale，
// 免得她看着一个三小时前的百分比以为是现在的。
const CLAUDE_STALE_SECONDS = 15 * 60
const CODEX_STALE_SECONDS = 30 * 60

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'))
  } catch (err) {
    return err.code === 'ENOENT' ? null : { _error: err.code || 'parse_failed' }
  }
}

// reset_at 是写入时刻算的绝对时间戳，读的时候要按「现在」重算倒计时，
// 否则快照放久了倒计时会一直显示写入那一刻的旧值。
function withCountdown(w) {
  if (!w || typeof w !== 'object') return null
  const resetAt = Number(w.reset_at) || 0
  return {
    used_percent: Number(w.used_percent) || 0,
    reset_at: resetAt,
    reset_after_seconds: resetAt > 0 ? Math.max(0, Math.round(resetAt - Date.now() / 1000)) : null,
  }
}

function ageOf(snapshot) {
  const updated = Number(snapshot?.updated_at) || 0
  return updated > 0 ? Math.round(Date.now() / 1000 - updated) : null
}

function claudePart() {
  const d = readJson(CLAUDE_FILE)
  if (!d) return { available: false, error: 'statusline_not_seen_yet' }
  if (d._error) return { available: false, error: d._error }
  const age = ageOf(d)
  return {
    available: true,
    stale: age === null || age > CLAUDE_STALE_SECONDS,
    age_seconds: age,
    model: d.model || '',
    five_hour: withCountdown(d.five_hour),
    seven_day: withCountdown(d.seven_day),
    context_used_percent: d.context_used_percent ?? null,
    context_window_size: d.context_window_size ?? null,
    session_cost_usd: d.session_cost_usd ?? null,
  }
}

function codexPart() {
  const d = readJson(CODEX_FILE)
  if (!d) return { available: false, error: 'snapshot_missing' }
  if (d._error) return { available: false, error: d._error }
  if (!d.available) return { available: false, error: d.error || 'unknown' }
  const age = ageOf(d)
  return {
    available: true,
    stale: age === null || age > CODEX_STALE_SECONDS,
    age_seconds: age,
    plan: d.plan || '',
    limit_reached: !!d.limit_reached,
    primary: withCountdown(d.primary),
    secondary: withCountdown(d.secondary),
  }
}

// 挑一条给她看的人话结论。她要的不是四个百分比，是「现在能不能放心使唤我们」。
function verdict(claude, codex) {
  const worries = []
  if (claude.available && !claude.stale) {
    const top = Math.max(claude.five_hour?.used_percent || 0, claude.seven_day?.used_percent || 0)
    if (top >= 90) worries.push('涟言额度快见底了')
    else if (top >= 75) worries.push('涟言额度过半偏多')
    if ((claude.context_used_percent || 0) >= 85) worries.push('涟言这个窗口快满了，随时会压缩')
  }
  if (codex.available && !codex.stale) {
    if (codex.limit_reached) worries.push('小扣已经撞限额了')
    else {
      const top = Math.max(codex.primary?.used_percent || 0, codex.secondary?.used_percent || 0)
      if (top >= 85) worries.push('小扣额度快见底了')
    }
  }
  if (worries.length) return { level: 'warn', text: worries.join('；') }
  if (!claude.available && !codex.available) return { level: 'unknown', text: '两边都还没有数据' }
  return { level: 'ok', text: '都还宽裕' }
}

function getUsage() {
  const claude = claudePart()
  const codex = codexPart()
  return { ok: true, now: Math.round(Date.now() / 1000), claude, codex, verdict: verdict(claude, codex) }
}

module.exports = { getUsage }
