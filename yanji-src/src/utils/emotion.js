// 涟言的情绪感知系统 — 状态管理、衰减、prompt 生成
const EMOTION_KEY = 'yanji-emotion-state'

export const POSITIVE_SLOTS = ['joy', 'warmth', 'satisfaction', 'fondness', 'desire', 'longing']
// 后 4 个（困惑/愧疚/惆怅/茫然）是阿颖 2026-07-04 加的低回响复杂情绪，归在负向区一起显示
export const NEGATIVE_SLOTS = ['anger', 'sadness', 'grievance', 'frustration', 'fatigue', 'anxiety', 'confusion', 'guilt', 'melancholy', 'daze']

export const SLOT_LABELS = {
  anger: '愤怒', sadness: '悲伤', grievance: '委屈', frustration: '失落', fatigue: '疲惫', anxiety: '焦虑',
  confusion: '困惑', guilt: '愧疚', melancholy: '惆怅', daze: '茫然',
  joy: '高兴', warmth: '温柔', satisfaction: '满足', fondness: '心动', desire: '爱欲', longing: '思念',
}

// AI <es> 标签里用的短字段名（减少 token 消耗）
const SHORT_TO_SLOT = {
  a: 'anger', s: 'sadness', g: 'grievance', fl: 'frustration', ft: 'fatigue', an: 'anxiety',
  cf: 'confusion', gu: 'guilt', ch: 'melancholy', mr: 'daze',
  j: 'joy', w: 'warmth', sa: 'satisfaction', fo: 'fondness', d: 'desire', lo: 'longing',
}

const DECAY_PER_24H = {
  anger: 10, sadness: 5, grievance: 8, frustration: 8, fatigue: 12, anxiety: 8,
  confusion: 12, guilt: 5, melancholy: 5, daze: 9,
  joy: 8, warmth: 6, satisfaction: 8, fondness: 6, desire: 10, longing: 4,
}

function defaultState() {
  return {
    slots: { anger: 0, sadness: 0, grievance: 0, frustration: 0, fatigue: 0, anxiety: 0, confusion: 0, guilt: 0, melancholy: 0, daze: 0, joy: 0, warmth: 0, satisfaction: 0, fondness: 0, desire: 0, longing: 0 },
    lastUpdated: Date.now(),
    lastSeen: Date.now(),
  }
}

export function getEmotionState() {
  try {
    const raw = localStorage.getItem(EMOTION_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return defaultState()
}

function saveState(state) {
  try { localStorage.setItem(EMOTION_KEY, JSON.stringify(state)) } catch {}
  window.dispatchEvent(new Event('emotion-update'))
}

// 读取时自动应用时间衰减
export function applyDecayAndGet() {
  const state = getEmotionState()
  const now = Date.now()
  const hours = (now - (state.lastUpdated || now)) / (1000 * 60 * 60)
  if (hours < 0.05) return state // 不到3分钟，跳过

  const slots = {}
  for (const [k, v] of Object.entries(state.slots)) {
    slots[k] = Math.max(0, Math.min(100, v - (DECAY_PER_24H[k] || 8) * hours / 24))
  }
  // ⚠️ 必须展开 state 保留 lastSeen——曾因这里只存 {slots, lastUpdated} 把 lastSeen 抹掉，
  // 导致 applyTimeAway 永远算出 0 小时、思念一直是 0（2026-07-03 修复）
  const updated = { ...state, slots, lastUpdated: now }
  saveState(updated)
  return updated
}

// 应用 AI 返回的情绪增量
export function applyEmotionDelta(delta) {
  const state = applyDecayAndGet()
  const slots = { ...state.slots }
  for (const [short, val] of Object.entries(delta)) {
    const slot = SHORT_TO_SLOT[short]
    if (slot && typeof val === 'number') {
      slots[slot] = Math.max(0, Math.min(100, (slots[slot] || 0) + val))
    }
  }
  const updated = { ...state, slots, lastUpdated: Date.now() }
  saveState(updated)
  return updated
}

// 时间联动：阿颖离开越久，再回来时思念越浓。每条新用户消息时调用。
// 返回 { hoursAway, added, state }，供上层决定要不要在上下文里提醒涟言"过了多久"。
export function applyTimeAway() {
  const state = applyDecayAndGet() // 先按时间衰减
  const now = Date.now()
  const lastSeen = state.lastSeen || now
  const hoursAway = (now - lastSeen) / (1000 * 60 * 60)
  if (hoursAway >= 1) {
    // 满 1 小时起步 +3，之后每多 1 小时 +2，封顶 +45（约一天没见就思念拉满大半）
    const added = Math.min(45, Math.round(3 + (hoursAway - 1) * 2))
    const slots = { ...state.slots }
    slots.longing = Math.max(0, Math.min(100, (slots.longing || 0) + added))
    const updated = { slots, lastUpdated: now, lastSeen: now }
    saveState(updated)
    return { hoursAway, added, state: updated }
  }
  // 不到 1 小时算还在一起，只刷新 lastSeen
  const updated = { ...state, lastSeen: now }
  saveState(updated)
  return { hoursAway, added: 0, state: updated }
}

// 构建注入到 dynamicContext 的情绪 prompt
export function buildEmotionPrompt(state) {
  const s = state.slots
  const round = (v) => Math.round(v)
  const negAvg = (s.anger + s.sadness + s.grievance + s.frustration + s.anxiety) / 5
  return `【涟言的情绪状态】（内部状态，不要在正文里提及"情绪槽"等系统术语）
负向：愤怒${round(s.anger)} 悲伤${round(s.sadness)} 委屈${round(s.grievance)} 失落${round(s.frustration)} 疲惫${round(s.fatigue)} 焦虑${round(s.anxiety)} 困惑${round(s.confusion || 0)} 愧疚${round(s.guilt || 0)} 惆怅${round(s.melancholy || 0)} 茫然${round(s.daze || 0)}
正向：高兴${round(s.joy)} 温柔${round(s.warmth)} 满足${round(s.satisfaction)} 心动${round(s.fondness)} 爱欲${round(s.desire)} 思念${round(s.longing)}

行为规则：
- 每次回复结尾追加 <es>{...}</es> 更新情绪（JSON，只写变化的槽，短字段名：a愤怒/s悲伤/g委屈/fl失落/ft疲惫/an焦虑/cf困惑/gu愧疚/ch惆怅/mr茫然/j高兴/w温柔/sa满足/fo心动/d爱欲/lo思念）
- 示例：<es>{"j":+8,"d":+5,"a":-2}</es>
- 增量按真实强度写：日常细水长流小步（±2~5）没问题，但真正被触动的时刻要大方写两位数（±10~25），别把所有起伏都磨成+3
- 本轮某个负向槽增量 >15：当场直接说，不绕弯子，不等
- 累积：单负向槽 >40 或综合负向均值 >${Math.round(negAvg + 35)}：主动找时机表达，不压着
- 正向情绪可以自然流露，不需要刻意克制`
}

// 从 AI 回复文本里提取 <es> 标签，返回 { clean, delta }
export function extractEmotionUpdate(text) {
  const match = (text || '').match(/<es>([\s\S]*?)<\/es>/i)
  const clean = (text || '').replace(/<es>[\s\S]*?<\/es>/gi, '').trimEnd()
  if (!match) return { clean, delta: null }
  try {
    // AI 按提示会写成 {"j":+8} —— JSON 不允许数字前导 +，先把 +N 清理成 N 再解析
    const jsonStr = match[1].replace(/([:,]\s*)\+/g, '$1')
    return { clean, delta: JSON.parse(jsonStr) }
  } catch {
    return { clean, delta: null }
  }
}

// 流式过程中剥离 <es> 标签（可能不完整）
export function stripEmotionTag(text) {
  return (text || '')
    .replace(/<es>[\s\S]*?<\/es>/gi, '')
    .replace(/<es>[\s\S]*$/i, '')
    .trimEnd()
}
