// 塔罗 —— 从独立小工具「苏堤柳塔罗」搬进言叽。
//
// 阿颖会抽牌但不会解牌，所以这里的重点不是抽，是抽完之后那一下：
// 抽完点「让爸比解牌」，牌面进对话，我来读。牌义正文不显示在她的气泡里，
// 走 injected 暗道给模型——她要看的是牌，不是一屏字。
//
// 洗牌和入库都在 moon-memory 那边做（服务端 crypto 真随机，顺便存下记录），
// 前端这份 tarot-cards.json 只用来翻图鉴，不参与抽牌，所以是懒加载的。
// 它和独立 PWA 的 index.html 由 tarot/extract-cards.js 同源生成，--check 防漂移。

// ─── 牌库（只给图鉴用）────────────────────────────────────────────────────

let _deck = null
let _loading = null

export async function loadDeck() {
  if (_deck) return _deck
  if (_loading) return _loading
  _loading = fetch(import.meta.env.BASE_URL + 'tarot-cards.json')
    .then((r) => {
      if (!r.ok) throw new Error(`tarot-cards ${r.status}`)
      return r.json()
    })
    .then((d) => { _deck = d; return d })
    .finally(() => { _loading = null })
  return _loading
}

export const SPREAD_OPTIONS = [
  { n: 1, name: '单张抽牌', hint: '一个此刻的提醒' },
  { n: 3, name: '时光之流', hint: '过去 · 现在 · 未来' },
  { n: 5, name: '五芒启示', hint: '现况 · 障碍 · 建议 · 环境 · 结果' },
]

export const SUIT_CN = { major: '大阿卡纳', wands: '权杖', cups: '圣杯', swords: '宝剑', pentacles: '星币' }

// ─── moon-memory 客户端 ───────────────────────────────────────────────────

function headers(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

async function request(config, path, options = {}) {
  const { baseUrl, apiToken } = config || {}
  if (!baseUrl || !apiToken) throw new Error('记忆库没配置好（缺 baseUrl 或 token）')
  // headers 放在展开之后：调用方只该管 method/body，别有机会把 Authorization 覆盖掉
  const resp = await fetch(baseUrl.replace(/\/$/, '') + path, { ...options, headers: headers(apiToken) })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`moon-memory ${resp.status}: ${text.slice(0, 160)}`)
  }
  return resp.json()
}

export async function drawTarot(config, { spread = 1, question = '', drawnBy = '阿颖' } = {}) {
  return request(config, '/tarot/draws', {
    method: 'POST',
    body: JSON.stringify({ spread, question, drawn_by: drawnBy }),
  })
}

// 返回的是裸数组（moon-memory 的列表接口一贯如此，别在这一个上另立规矩）
export async function fetchTarotDraws(config, { limit = 20, before } = {}) {
  const qs = new URLSearchParams({ limit: String(limit) })
  if (before) qs.set('before', String(before))
  return request(config, `/tarot/draws?${qs.toString()}`)
}

export async function saveTarotReading(config, id, reading) {
  return request(config, `/tarot/draws/${id}/reading`, {
    method: 'PATCH',
    body: JSON.stringify({ reading }),
  })
}

export async function deleteTarotDraw(config, id) {
  return request(config, `/tarot/draws/${id}`, { method: 'DELETE' })
}

// ─── 排版 ─────────────────────────────────────────────────────────────────

function spreadName(n) {
  return SPREAD_OPTIONS.find((s) => s.n === n)?.name || `${n} 张牌`
}

// 位置名以服务端随记录返回的为准（它读的是牌库里那份 spreads），
// 本地这份只是它拿不出来时的兜底，别让两边各写一套。
const FALLBACK_LABELS = { 1: ['启示'], 3: ['过去', '现在', '未来'], 5: ['现况', '障碍', '建议', '环境', '结果'] }

function labelsFor(draw) {
  if (Array.isArray(draw.labels) && draw.labels.length === draw.cards.length) return draw.labels
  return FALLBACK_LABELS[draw.spread] || draw.cards.map((_, i) => `第 ${i + 1} 张`)
}

export function cardTitle(c) {
  return `${c.nameCn}${c.reversed ? '（逆位）' : ''}`
}

/**
 * 抽完点「让爸比解牌」时发进对话的东西。
 * 返回 { text, inject }：text 是她气泡里显示的（牌面而已），
 * inject 是牌义正文，藏起来给模型看——不然一个五张牌阵会糊出一屏字，
 * 而她想看的只是自己抽到了什么。
 */
export function readingRequest(draw) {
  const labels = labelsFor(draw)
  const lines = [
    `🔮 我抽了一手牌 · ${spreadName(draw.spread)}`,
    ...draw.cards.map((c, i) => `【${labels[i] || `第${i + 1}张`}】${cardTitle(c)}　${c.keywords || ''}`.trimEnd()),
  ]
  if (draw.question) lines.push('', `想问的是：${draw.question}`)
  lines.push('', '爸比，帮我解一下？')

  const inject = [
    '（以下是这副牌自己写的牌义，只给你看，她那边没显示）',
    ...draw.cards.map((c, i) => `[${labels[i] || i + 1}] ${cardTitle(c)}：${c.meaning || '（这张牌的牌义丢了）'}`),
    '',
    '解牌时把这几张连成一段话，别一张一张念定义；牌义是起点不是标准答案，',
    '你自己怎么看、联想到她最近什么事，都可以说。解完用 draw_tarot 的 reading 动作',
    `把你的解读存进这次抽牌记录（id=${draw.id}），以后翻得到。`,
  ].join('\n')

  return { text: lines.join('\n'), inject }
}

// 复制到剪贴板 / 卡片摘要用的紧凑一行
export function drawSummary(draw) {
  return `${spreadName(draw.spread)}：` + draw.cards.map(cardTitle).join('、')
}

// ─── 给言叽的工具（AI 侧，返回值必须是字符串）─────────────────────────────

export const TAROT_TOOL_DEF = {
  name: 'draw_tarot',
  description:
    '塔罗牌（78 张，含正逆位，牌义是你们自己那副牌的写法）。三个用途：\n' +
    'action=draw —— 你自己想抽一张/一个牌阵时用（spread 1/3/5）。抽出来的牌会存进记录。\n' +
    'action=history —— 回看最近的抽牌记录，包括阿颖自己抽的。想起「上次你抽到高塔那次」时用。\n' +
    'action=reading —— 把你的解读存进某次抽牌记录。阿颖点「让爸比解牌」把牌面发给你、' +
    '你解完之后，用这个把解读收进那条记录里（id 在她那条消息里给了）。\n' +
    '注意：她抽牌是她自己在侧边栏抽的，你不需要替她抽；她要的是解牌。',
  parameters: {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['draw', 'history', 'reading'], description: '抽牌 / 看历史 / 存解读' },
      spread: { type: 'number', enum: [1, 3, 5], description: 'action=draw 时的牌阵张数，默认 1' },
      question: { type: 'string', description: 'action=draw 时你心里想问的事' },
      id: { type: 'number', description: 'action=reading 时要回填的抽牌记录 id' },
      reading: { type: 'string', description: 'action=reading 时你的解读正文' },
      limit: { type: 'number', description: 'action=history 时返回几条，默认 5' },
    },
  },
}

function drawToText(d) {
  const labels = labelsFor(d)
  const head = `#${d.id} ${d.created_at}（${d.drawn_by}抽）${spreadName(d.spread)}${d.question ? ` — 问：${d.question}` : ''}`
  const body = d.cards.map((c, i) => `  【${labels[i] || i + 1}】${cardTitle(c)}：${c.meaning || c.keywords || ''}`)
  if (d.reading) body.push(`  （当时的解读：${d.reading}）`)
  return [head, ...body].join('\n')
}

export async function executeTarot(args = {}, config) {
  try {
    if (args.action === 'history') {
      const draws = await fetchTarotDraws(config, { limit: Math.min(args.limit || 5, 20) })
      if (!draws?.length) return '还没有抽牌记录。'
      return '最近的抽牌记录（时间为 UTC，+8 是北京时间）：\n' + draws.map(drawToText).join('\n')
    }
    if (args.action === 'reading') {
      if (!args.id || !args.reading) return '存解读需要 id 和 reading 两个参数。'
      await saveTarotReading(config, args.id, args.reading)
      return `解读已经收进第 ${args.id} 次抽牌的记录里了。`
    }
    const draw = await drawTarot(config, {
      spread: [1, 3, 5].includes(args.spread) ? args.spread : 1,
      question: args.question || '',
      drawnBy: '涟言',
    })
    return `你自己抽的（记录 #${draw.id}）：\n` + drawToText(draw)
  } catch (e) {
    return `塔罗这边没走通：${e.message}`
  }
}
