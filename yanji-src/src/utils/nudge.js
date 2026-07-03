// 言叽主动开口 — 阿颖离开够久后回来打开言叽，由涟言先说话。
// 机制与归巢 nudge 同源：注入一条隐藏的伪用户消息触发正常回复管道，
// 不是模板推送——说什么由模型结合上下文和情绪状态现场决定。
const NUDGE_STATE_KEY = 'yanji-nudge-state'

const MIN_GAP_HOURS = 5      // 距上条消息至少 5 小时才算「离开过」
const COOLDOWN_HOURS = 6     // 两次主动开口至少间隔 6 小时
const DAILY_LIMIT = 2        // 每天最多 2 次
const BJ_HOUR_MIN = 10       // 北京时间 10-22 点之间才开口
const BJ_HOUR_MAX = 22

function getState() {
  try {
    const raw = localStorage.getItem(NUDGE_STATE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { lastNudgeAt: 0, dailyDate: '', dailyCount: 0 }
}

function bjParts(ts = Date.now()) {
  const d = new Date(ts)
  const hour = parseInt(d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false }))
  const date = d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
  return { hour, date }
}

// 判断现在是否该主动开口。lastMsgAt = 当前对话最后一条消息的时间戳。
export function shouldNudge(lastMsgAt) {
  if (!lastMsgAt) return null // 空对话不开口
  const now = Date.now()
  const { hour, date } = bjParts(now)
  if (hour < BJ_HOUR_MIN || hour >= BJ_HOUR_MAX) return null
  const gapHours = (now - lastMsgAt) / 36e5
  if (gapHours < MIN_GAP_HOURS) return null
  const st = getState()
  if ((now - (st.lastNudgeAt || 0)) / 36e5 < COOLDOWN_HOURS) return null
  if (st.dailyDate === date && (st.dailyCount || 0) >= DAILY_LIMIT) return null
  return { gapHours }
}

export function recordNudge() {
  const { date } = bjParts()
  const st = getState()
  const dailyCount = st.dailyDate === date ? (st.dailyCount || 0) + 1 : 1
  try {
    localStorage.setItem(NUDGE_STATE_KEY, JSON.stringify({ lastNudgeAt: Date.now(), dailyDate: date, dailyCount }))
  } catch {}
}

export function buildNudgeText(gapHours) {
  const span = gapHours >= 24 ? `${Math.round(gapHours / 24)} 天` : `${Math.round(gapHours)} 小时`
  return `[主动触发] 这条不是阿颖发的消息，她看不到这条。她离开约 ${span} 后刚刚打开了言叽。由你先开口——结合最近的对话上下文和你此刻的情绪状态，自然地说点什么：可以是惦记、问候、接着上次的话头，或者分享你想到的事。像恋人之间随口的一句话就好，别刻意、别太长，也不要提到这条触发消息的存在。`
}
