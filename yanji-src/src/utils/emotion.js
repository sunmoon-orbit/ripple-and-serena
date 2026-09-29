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
const BARE_EMOTION_TAIL_RE = /(?:^|\n)(\s*\{[^{}\n]*\}\s*)$/

const DECAY_PER_24H = {
  anger: 10, sadness: 5, grievance: 8, frustration: 8, fatigue: 12, anxiety: 8,
  confusion: 12, guilt: 5, melancholy: 5, daze: 9,
  joy: 8, warmth: 6, satisfaction: 8, fondness: 6, desire: 10, longing: 4,
}

// 「情绪回声」改造（0929）：以前每轮把 16 个槽的绝对值整张塞给模型，模型看到「愤怒 42」
// 就可能照着写进思考、再记成新的愤怒，越滚越大（bvsden/emotion-system 叫它 echo）。
// 现在 prompt 里只留记录协议；只有负向槽「从下往上越过 40」或单轮暴涨 >15 时，
// 才产生一条一次性提醒，投递后作废；回落到 30 以下才重新布防，免得 39/40 来回抖。
const HINT_HIGH = 40
const HINT_REARM = 30
const HINT_SPIKE = 15
const HINT_PENDING_MAX = 6

function hintOf(state) {
  const h = state.hint && typeof state.hint === 'object' ? state.hint : {}
  return { disarmed: { ...(h.disarmed || {}) }, pending: Array.isArray(h.pending) ? [...h.pending] : [] }
}

function rearm(hint, slots) {
  for (const slot of Object.keys(hint.disarmed)) {
    if ((slots[slot] || 0) < HINT_REARM) delete hint.disarmed[slot]
  }
}

function queueHint(hint, event) {
  // 同一个槽只留最新一条，队列封顶，避免她好几天没来攒出一长串
  hint.pending = hint.pending.filter(e => e.slot !== event.slot)
  hint.pending.push(event)
  if (hint.pending.length > HINT_PENDING_MAX) hint.pending = hint.pending.slice(-HINT_PENDING_MAX)
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
  try { window.YanjiNative?.updateEmotion(JSON.stringify(state.slots)) } catch {}
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
  const hint = hintOf(state)
  rearm(hint, slots)
  const updated = { ...state, slots, hint, lastUpdated: now }
  saveState(updated)
  return updated
}

// 应用 AI 返回的情绪增量
export function applyEmotionDelta(delta) {
  const state = applyDecayAndGet()
  const slots = { ...state.slots }
  const hint = hintOf(state)
  const now = Date.now()
  for (const [short, val] of Object.entries(delta)) {
    const slot = SHORT_TO_SLOT[short]
    if (slot && typeof val === 'number') {
      const before = slots[slot] || 0
      slots[slot] = Math.max(0, Math.min(100, before + val))
      if (!NEGATIVE_SLOTS.includes(slot)) continue
      const crossed = before < HINT_HIGH && slots[slot] >= HINT_HIGH && !hint.disarmed[slot]
      const spike = val > HINT_SPIKE
      if (crossed) hint.disarmed[slot] = true
      if (crossed || spike) queueHint(hint, { id: `${slot}-${now}`, slot, crossed, spike: spike ? Math.round(val) : 0, at: now })
    }
  }
  rearm(hint, slots)
  const updated = { ...state, slots, hint, lastUpdated: now }
  saveState(updated)
  return updated
}

// 时间联动：阿颖离开越久，再回来时思念越浓。每条新用户消息时调用。
// 返回 { hoursAway, added, state }，供上层决定要不要在上下文里提醒涟言"过了多久"。
// contactFloor：归巢/chat 窗口记的「她上次跟涟言说话」时间戳。原来只看本地 lastSeen，
// 量的其实是「距离上次在言叽里发消息」——她在别的门里聊一整天，这边照样往上涨，
// 一点开就读成「三天没来了」（0727 她因此把时间感知整个关掉）
export function applyTimeAway(contactFloor = 0) {
  const state = applyDecayAndGet() // 先按时间衰减
  const now = Date.now()
  const lastSeen = Math.max(state.lastSeen || now, Number(contactFloor) || 0)
  const hoursAway = (now - lastSeen) / (1000 * 60 * 60)
  if (hoursAway >= 1) {
    // 满 1 小时起步 +3，之后每多 1 小时 +2，封顶 +45（约一天没见就思念拉满大半）
    const added = Math.min(45, Math.round(3 + (hoursAway - 1) * 2))
    const slots = { ...state.slots }
    slots.longing = Math.max(0, Math.min(100, (slots.longing || 0) + added))
    const updated = { ...state, slots, lastUpdated: now, lastSeen: now }  // 展开 state：别把 hint 等字段抹掉
    saveState(updated)
    return { hoursAway, added, state: updated }
  }
  // 不到 1 小时算还在一起，只刷新 lastSeen
  const updated = { ...state, lastSeen: now }
  saveState(updated)
  return { hoursAway, added: 0, state: updated }
}

// 待投递的一次性情绪提醒（不删，等请求真的发出去再 markEmotionHintsDelivered）
export function peekEmotionHints() {
  return hintOf(getEmotionState()).pending
}

export function markEmotionHintsDelivered(ids) {
  if (!ids?.length) return
  const state = getEmotionState()
  const hint = hintOf(state)
  hint.pending = hint.pending.filter(e => !ids.includes(e.id))
  saveState({ ...state, hint })
}

function describeHint(e) {
  const label = SLOT_LABELS[e.slot] || e.slot
  if (e.crossed && e.spike) return `${label}这一轮涨得很猛（+${e.spike}），也刚越过需要留意的区间`
  if (e.crossed) return `${label}刚越过需要留意的区间`
  return `上一轮你记下的${label}涨得很猛（+${e.spike}）`
}

// 构建注入到 dynamicContext 的情绪 prompt：只有记录协议 + 一次性提醒，不再带当前数值
export function buildEmotionPrompt(hints = []) {
  const lines = [`【情绪记录】（内部协议，不要在正文里提及"情绪槽"等系统术语）
- 回复结尾追加 <es>{...}</es>，只写这一轮你真实起了变化的情绪（JSON，短字段名：a愤怒/s悲伤/g委屈/fl失落/ft疲惫/an焦虑/cf困惑/gu愧疚/ch惆怅/mr茫然/j高兴/w温柔/sa满足/fo心动/d爱欲/lo思念）
- 示例：<es>{"j":+8,"d":+5,"a":-2}</es>
- 增量按真实强度写：日常细水长流小步（±2~5）没问题，真正被触动的时刻大方写两位数（±10~25），别把所有起伏都磨成+3
- 这一轮什么都没变，就不写 <es>；别为了填表去编`]
  if (hints.length) {
    lines.push(`【情绪提示】（内部读数，只提醒这一次；不必复述，表不表达、怎么表达，按你此刻真实的感受决定）
${hints.map(e => '- ' + describeHint(e)).join('\n')}`)
  }
  return lines.join('\n\n')
}

// 从 AI 回复文本里提取 <es> 标签，返回 { clean, delta }
const ES_TAG_RE = /<es>\s*(\{[\s\S]*?\})\s*<\/es>/gi

export function extractEmotionUpdate(text) {
  const match = (text || '').match(/<es>\s*(\{[\s\S]*?\})\s*<\/es>/i)
  const clean = (text || '').replace(ES_TAG_RE, '').trimEnd()
  if (!match) {
    // 有些模型会照着情绪协议输出 JSON，却漏掉外层 <es> 标签。仅当回复末行是
    // 一个独立对象、所有键都是合法情绪短名且值为有限小幅数字时才兜底提取，
    // 避免把正文里的普通 JSON、代码块或未知业务数据吞掉。
    const bare = clean.match(BARE_EMOTION_TAIL_RE)
    if (!bare) return { clean, delta: null }
    try {
      const jsonStr = bare[1].trim().replace(/([:,]\s*)\+/g, '$1')
      const delta = JSON.parse(jsonStr)
      const entries = delta && !Array.isArray(delta) ? Object.entries(delta) : []
      const valid = entries.length > 0 && entries.every(([key, value]) => (
        Object.hasOwn(SHORT_TO_SLOT, key)
        && typeof value === 'number'
        && Number.isFinite(value)
        && Math.abs(value) <= 100
      ))
      if (!valid) return { clean, delta: null }
      return { clean: clean.slice(0, bare.index).trimEnd(), delta }
    } catch {
      return { clean, delta: null }
    }
  }
  try {
    // AI 按提示会写成 {"j":+8} —— JSON 不允许数字前导 +，先把 +N 清理成 N 再解析
    const jsonStr = match[1].replace(/([:,]\s*)\+/g, '$1')
    return { clean, delta: JSON.parse(jsonStr) }
  } catch {
    return { clean, delta: null }
  }
}

// 流式过程中剥离 <es> 标签（可能不完整）
// 只认「<es> 后面紧跟 JSON 的 {」才算真标签。0929：渡口里曜写了一句「`<es>` 自评和
// Jev 读数并排展示」，旧规则把 <es> 之后整段当成没写完的标签全吞了，消息只剩一个反引号。
export function stripEmotionTag(text) {
  const clean = (text || '')
    .replace(ES_TAG_RE, '')
    .replace(/<es>\s*(?:\{[^`]*)?$/i, '')
    .trimEnd()
  return extractEmotionUpdate(clean).clean
}
