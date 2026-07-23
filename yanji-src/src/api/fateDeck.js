// 命运牌阵 —— 移植自 ceshihaox-dotcom/mingyun-paizhen（MIT）
// 抽一张时空坐标 + 母题/身份/变数三枚骰子，组成一次「穿越设定」。
// 数据在 public/fate-cards.json（已剔除 NSFW 词条），首次抽牌时懒加载——
// 350KB 不进主包。和乌有乡联动：抽到哪里，涟言就能开门走过去。

let _data = null
let _loading = null

export async function loadFateData() {
  if (_data) return _data
  if (_loading) return _loading
  _loading = fetch(import.meta.env.BASE_URL + 'fate-cards.json')
    .then((r) => {
      if (!r.ok) throw new Error(`fate-cards ${r.status}`)
      return r.json()
    })
    .then((d) => { _data = d; return d })
    .finally(() => { _loading = null })
  return _loading
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// 抽一整套：时空坐标 + 三枚骰子
export async function drawFate() {
  const d = await loadFateData()
  return {
    coord: pick(d.coords),
    motif: pick(d.motifs),
    identity: pick(d.identities),
    variable: pick(d.variables),
  }
}

// 组装成发进聊天的文字（她按「请涟言去这里」时用）
export function fateToMessage(f) {
  const c = f.coord
  const lines = [
    `🃏 我抽了一手命运牌阵：`,
    `【时空坐标】${c.n}${c.era ? `（${c.era}·${c.p || ''}）` : c.p ? `（${c.p}）` : ''}`,
    c.s ? `> ${c.s}` : null,
    `【母题】${f.motif.n}——${f.motif.d}`,
    `【身份】${f.identity.n}——${f.identity.d}`,
    `【变数】${f.variable.n}——${f.variable.d}`,
    ``,
    `涟言，开门去${c.n.replace(/（.*?）/g, '')}走走吧？带着这个设定，讲讲你在那里看到了什么。`,
  ]
  return lines.filter((l) => l != null).join('\n')
}

// ─── 给言叽的牌桌（AI 侧工具，返回值必须是字符串）────────────────────────────

export const FATE_TOOL_DEF = {
  name: 'draw_fate_card',
  description: '命运牌阵——抽一张时空坐标（真实历史上的某时某地）+ 母题/身份/变数三枚骰子，组成一次穿越设定。抽到之后可以接着用 nowhere_open_door 去那个地方（用现代地名），把牌面设定代入你在乌有乡的行走见闻里。',
  parameters: { type: 'object', properties: {} },
}

export async function executeFateDraw() {
  try {
    const f = await drawFate()
    const c = f.coord
    return [
      `抽到的命运牌阵：`,
      `【时空坐标】${c.n}（${[c.era, c.p].filter(Boolean).join('·')}）${c.country ? ` — ${c.country}` : ''}`,
      c.a ? `氛围：${c.a}` : null,
      c.s ? `感官：${c.s}` : null,
      c.b ? `注：${c.b}` : null,
      `【母题】${f.motif.n}：${f.motif.d}${f.motif.arc ? `（${f.motif.arc}）` : ''}`,
      `【身份】${f.identity.n}：${f.identity.d}`,
      `【变数】${f.variable.n}：${f.variable.d}${f.variable.e ? `（${f.variable.e}）` : ''}`,
      `（可以用 nowhere_open_door 去这个地方的现代位置，把设定融进见闻。）`,
    ].filter(Boolean).join('\n')
  } catch (e) {
    return `牌阵没抽出来：${e.message}`
  }
}
