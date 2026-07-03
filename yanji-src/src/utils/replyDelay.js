// 延迟回复 —— 像一个不总盯着手机的人：阿颖发消息后，有一定概率不马上回，
// 晾一小会儿再回（期间她可以继续发，到点后一起看到、一起回）。
// 挡位由系统随机决定（她说的「自动选择延迟时间」），不是模型决定——
// 让模型决定得先调一次 API，延迟就成了摆设。
const PENDING_KEY = 'yanji-pending-reply' // { chatId, dueAt }

export const DELAY_MODES = [
  { id: 'off', label: '关闭（秒回）' },
  { id: 'light', label: '偶尔小晾（约1/3概率，1-5分钟）' },
  { id: 'busy', label: '常常在忙（约2/3概率，2-15分钟）' },
]

const MODE_PARAMS = {
  light: { chance: 0.35, minMin: 1, maxMin: 5 },
  busy: { chance: 0.65, minMin: 2, maxMin: 15 },
}

// 返回延迟毫秒数，0 = 马上回
export function decideReplyDelay(mode) {
  const p = MODE_PARAMS[mode]
  if (!p) return 0
  if (Math.random() >= p.chance) return 0
  const minutes = p.minMin + Math.random() * (p.maxMin - p.minMin)
  return Math.round(minutes * 60_000)
}

export function getPendingReply() {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null')
    return p && p.chatId && p.dueAt ? p : null
  } catch { return null }
}

export function setPendingReply(chatId, dueAt) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ chatId, dueAt })) } catch {}
}

export function clearPendingReply() {
  try { localStorage.removeItem(PENDING_KEY) } catch {}
}
