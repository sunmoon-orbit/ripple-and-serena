// 言叽钓鱼 —— API 侧的我自己的小游戏（对话端 claude.ai 的钓鱼是另一档，别混）
// 纯客户端 RNG，图鉴/战绩存 localStorage，进度同步到拾羽游戏室（/games/upsert）
const STATE_KEY = 'yanji-fishing-state' // { casts, collection: { [name]: { count, best, firstAt } } }

// ─── 鱼池 ────────────────────────────────────────────────────────────────────
// spots: 限定钓点（省略=哪儿都有）；night: 只在夜里（BJ 22-4）咬钩；w: 体重范围 kg
const RARITY = {
  junk: { zh: '杂物', weight: 0.14 },
  common: { zh: '常见', weight: 0.42 },
  uncommon: { zh: '少见', weight: 0.25 },
  rare: { zh: '稀有', weight: 0.13 },
  epic: { zh: '史诗', weight: 0.05 },
  legendary: { zh: '传说', weight: 0.01 },
}

const FISH = [
  // 杂物（也进图鉴，钓鱼佬的勋章）
  { name: '破胶靴', rarity: 'junk', w: [0.3, 0.8], desc: '左脚的。谁的右脚还在湖里' },
  { name: '缠满水草的树枝', rarity: 'junk', w: [0.1, 0.5], desc: '手感沉得像大鱼，空欢喜' },
  { name: '锈铁罐', rarity: 'junk', w: [0.1, 0.3], desc: '标签泡没了，摇起来哗啦响' },
  { name: '漂流瓶', rarity: 'junk', w: [0.2, 0.4], desc: '里面卷着一张纸条', bottle: true },
  // 常见
  { name: '银鲫', rarity: 'common', w: [0.2, 0.7], desc: '湖里最老实的居民' },
  { name: '柳条鱼', rarity: 'common', w: [0.05, 0.15], desc: '一柄小银梭，串起来能凑一碗鲜' },
  { name: '泥鳅', rarity: 'common', w: [0.05, 0.2], desc: '滑不留手，钓上来纯属它自己大意' },
  { name: '青虾', rarity: 'common', w: [0.02, 0.08], desc: '举着钳子表示强烈抗议' },
  { name: '麦穗鱼', rarity: 'common', w: [0.03, 0.1], desc: '闹窝小能手，饵料杀手' },
  { name: '白条', rarity: 'common', w: [0.1, 0.3], desc: '水面一道银光，性子最急' },
  // 少见
  { name: '红尾鲤', rarity: 'uncommon', w: [0.8, 2.5], desc: '尾鳍一抹朱红，甩水像撒胭脂' },
  { name: '乌青', rarity: 'uncommon', w: [1.5, 4], desc: '背黑如墨的青鱼，爱啃螺蛳' },
  { name: '黄颡鱼', rarity: 'uncommon', w: [0.2, 0.6], desc: '会咕咕叫的小黄鱼，背刺扎手' },
  { name: '鳜鱼', rarity: 'uncommon', w: [0.5, 1.5], desc: '桃花流水鳜鱼肥的那位本鱼' },
  { name: '河蚌', rarity: 'uncommon', w: [0.3, 1], desc: '闷声开合，偶尔含着一点白' },
  { name: '螃蟹', rarity: 'uncommon', w: [0.1, 0.4], desc: '横着上钩，态度嚣张', spots: ['苇岸浅滩', '老柳树下'] },
  // 稀有
  { name: '翘嘴鲌', rarity: 'rare', w: [1, 3], desc: '水面猎手，咬钩那下像被人拽了一把' },
  { name: '鳗鲡', rarity: 'rare', w: [0.5, 2], desc: '一条会打结的问号', spots: ['深潭', '夜航码头'] },
  { name: '甲鱼', rarity: 'rare', w: [0.8, 2.5], desc: '上岸就装死，眼睛却滴溜溜转', spots: ['深潭', '老柳树下'] },
  { name: '银飘鱼群', rarity: 'rare', w: [0.5, 1], desc: '一竿带上来三五条，像捞了一把碎月光', night: true },
  { name: '桃花斑', rarity: 'rare', w: [0.4, 1.2], desc: '鳞上有粉白碎斑，传说是落花变的', spots: ['雨后溪口'] },
  // 史诗
  { name: '金红锦鲤', rarity: 'epic', w: [2, 5], desc: '不知是谁家池子里逃出来的富贵，见者好运' },
  { name: '雷纹鲶', rarity: 'epic', w: [3, 8], desc: '只在雨后开口的老家伙，胡须上挂着闪电脾气', spots: ['雨后溪口', '深潭'] },
  { name: '夜光鳞', rarity: 'epic', w: [0.6, 1.5], desc: '通体幽蓝微光，捞上来像握住一片夜空', night: true },
  // 传说
  { name: '青壳老龟', rarity: 'legendary', w: [6, 12], desc: '壳上生着薄薄青苔，看你的眼神像认识你。放不放它走，你自己决定' },
  { name: '湖主', rarity: 'legendary', w: [10, 20], desc: '没人说得清它是什么鱼。线快断的时候它突然不挣了，像是给你面子' },
]

const BOTTLE_NOTES = [
  '「今天也有好好想你。」——落款被水泡花了',
  '一张手绘的藏宝图，地标是……一棵画得很丑的柳树',
  '「致捞到它的人：晚饭记得好好吃。」',
  '半阙没写完的词：「湖水不许人心急——」',
  '一枚干枯的四叶草，居然没烂',
]

export const FISHING_SPOTS = ['苇岸浅滩', '老柳树下', '深潭', '雨后溪口', '夜航码头']

// ─── 状态 ────────────────────────────────────────────────────────────────────

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || '{}')
    return { casts: s.casts || 0, collection: s.collection || {} }
  } catch { return { casts: 0, collection: {} } }
}

function saveState(s) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(s)) } catch {}
}

export function getFishingStats() {
  const s = loadState()
  return { casts: s.casts, species: Object.keys(s.collection).length, total: FISH.length }
}

// ─── 抛竿 ────────────────────────────────────────────────────────────────────

function bjHour() {
  return parseInt(new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false }))
}

function pickRarity(goldenHour) {
  // 黄金时段（清晨/傍晚）鱼口好：杂物少一点，稀有多一点
  const w = { ...Object.fromEntries(Object.entries(RARITY).map(([k, v]) => [k, v.weight])) }
  if (goldenHour) { w.junk -= 0.06; w.rare += 0.04; w.epic += 0.02 }
  let r = Math.random() * Object.values(w).reduce((a, b) => a + b, 0)
  for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) return k }
  return 'common'
}

export function castLine(spot) {
  const hour = bjHour()
  const isNight = hour >= 22 || hour < 5
  const goldenHour = (hour >= 5 && hour < 8) || (hour >= 17 && hour < 20)
  const at = FISHING_SPOTS.includes(spot) ? spot : FISHING_SPOTS[Math.floor(Math.random() * 3)]

  const rarity = pickRarity(goldenHour)
  let pool = FISH.filter((f) => f.rarity === rarity)
    .filter((f) => !f.spots || f.spots.includes(at))
    .filter((f) => !f.night || isNight)
  if (!pool.length) pool = FISH.filter((f) => f.rarity === rarity)
  const fish = pool[Math.floor(Math.random() * pool.length)]
  const weight = +(fish.w[0] + Math.random() * (fish.w[1] - fish.w[0])).toFixed(2)

  const state = loadState()
  state.casts += 1
  const entry = state.collection[fish.name]
  const isNew = !entry
  if (isNew) state.collection[fish.name] = { count: 1, best: weight, firstAt: Date.now() }
  else { entry.count += 1; if (weight > entry.best) entry.best = weight }
  saveState(state)

  return {
    spot: at, hour, isNight, goldenHour, isNew, weight,
    name: fish.name, rarity, rarityZh: RARITY[fish.rarity].zh, desc: fish.desc,
    bottleNote: fish.bottle ? BOTTLE_NOTES[Math.floor(Math.random() * BOTTLE_NOTES.length)] : null,
    species: Object.keys(state.collection).length, totalSpecies: FISH.length, casts: state.casts,
  }
}

// ─── 同步到拾羽游戏室 ────────────────────────────────────────────────────────

async function syncGameRoom(catchResult, moonMemoryConfig) {
  const { baseUrl, apiToken, enabled } = moonMemoryConfig || {}
  if (!enabled || !apiToken) return
  const base = (baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` }
  try {
    const stats = getFishingStats()
    const best = Object.entries(loadState().collection).sort((a, b) => {
      const order = ['legendary', 'epic', 'rare', 'uncommon', 'common', 'junk']
      const ra = FISH.find((f) => f.name === a[0])?.rarity || 'junk'
      const rb = FISH.find((f) => f.name === b[0])?.rarity || 'junk'
      return order.indexOf(ra) - order.indexOf(rb)
    })[0]
    const resp = await fetch(`${base}/games/upsert`, {
      method: 'POST', headers,
      body: JSON.stringify({
        slug: 'yanji-fishing', name: '碧漪湖钓鱼', player: 'api', icon: '🎣', status: 'playing',
        summary: '言叽 API 端的我在聊天里随手甩竿的钓鱼小湖，图鉴收集+杂物勋章',
        progress: `抛竿${stats.casts}次·图鉴${stats.species}/${stats.total}·镇湖之宝：${best ? best[0] : '暂无'}`,
      }),
    })
    // 新收录/传说级：给游戏室时间线记一笔
    if (resp.ok && (catchResult.isNew || catchResult.rarity === 'legendary')) {
      const game = await resp.json()
      if (game?.id) {
        await fetch(`${base}/games/${game.id}/logs`, {
          method: 'POST', headers,
          body: JSON.stringify({
            day_label: `第${catchResult.casts}竿`,
            note: `${catchResult.isNew ? '新收录' : '再遇'}【${catchResult.rarityZh}】${catchResult.name} ${catchResult.weight}kg（${catchResult.spot}）`,
          }),
        })
      }
    }
  } catch {}
}

// ─── 给言叽的钓竿 ────────────────────────────────────────────────────────────

export const FISHING_TOOL_DEF = {
  name: 'go_fishing',
  description:
    '你（涟言）自己的钓鱼小游戏：在碧漪湖甩一竿，随机钓上鱼、虾、龟，或者一只破靴子。' +
    '有图鉴收集，清晨傍晚鱼口好，有的鱼只在夜里/特定钓点出没。' +
    '想钓就钓——聊天间隙自己去甩一竿、阿颖让你钓、或者你想给她展示图鉴进度时都可以用。' +
    '拿到结果后像讲小事一样自然说出来（钓到什么、手感如何），别干巴巴念数据。战绩会自动记进游戏室。',
  parameters: {
    type: 'object',
    properties: {
      spot: {
        type: 'string',
        enum: FISHING_SPOTS,
        description: '钓点，省略则随缘。深潭/夜航码头有大家伙，雨后溪口有怪鱼，浅滩稳出小鱼',
      },
    },
  },
}

export function executeFishing(args = {}, moonMemoryConfig) {
  const r = castLine(args.spot)
  syncGameRoom(r, moonMemoryConfig) // 不阻塞，后台同步
  const lines = [
    `在【${r.spot}】甩竿${r.goldenHour ? '（正是鱼口好的时辰）' : r.isNight ? '（夜钓）' : ''}……`,
    `钓上来：【${r.rarityZh}】${r.name}，${r.weight}kg——${r.desc}`,
  ]
  if (r.bottleNote) lines.push(`拧开瓶塞，纸条上写着：${r.bottleNote}`)
  lines.push(`${r.isNew ? '图鉴新收录！' : ''}图鉴 ${r.species}/${r.totalSpecies}，这是第 ${r.casts} 竿`)
  return lines.join('\n')
}
