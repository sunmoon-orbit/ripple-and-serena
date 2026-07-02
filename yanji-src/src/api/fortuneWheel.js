// 幸运轮盘 —— 移植自 29-Cu/Ruota-della-Fortuna（MIT）
// 纯客户端摇奖：7 个维度的标签库打包进前端，自定义标签存 localStorage
import DIMENSIONS from '../data/ruota-tags.json'

const CUSTOM_KEY = 'fortune_wheel_custom_tags' // { [dimensionId]: [{zh,en,ja}] }

export function getDimensions() {
  return DIMENSIONS.map((d) => ({ id: d.id, zh: d.zh, full: d.full, gore: !!d.gore, count: d.tags.length + getCustomTags(d.id).length }))
}

export function getCustomTags(dimId) {
  try {
    const all = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}')
    return Array.isArray(all[dimId]) ? all[dimId] : []
  } catch { return [] }
}

export function addCustomTag(dimId, zh) {
  const text = (zh || '').trim()
  if (!text) return false
  const all = (() => { try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}') } catch { return {} } })()
  if (!Array.isArray(all[dimId])) all[dimId] = []
  if (all[dimId].some((t) => t.zh === text)) return false
  all[dimId].push({ zh: text, custom: true })
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(all))
  return true
}

export function removeCustomTag(dimId, zh) {
  const all = (() => { try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}') } catch { return {} } })()
  if (!Array.isArray(all[dimId])) return
  all[dimId] = all[dimId].filter((t) => t.zh !== zh)
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(all))
}

function poolFor(dim) {
  return [...dim.tags, ...getCustomTags(dim.id)]
}

// 摇一次。active = 维度 id 数组；gore 维度必须显式传 includeGore 才参与
export function spin({ active, includeGore = false } = {}) {
  const activeSet = active && active.length ? new Set(active) : null
  const results = []
  for (const dim of DIMENSIONS) {
    if (dim.gore && !includeGore) continue
    if (activeSet && !activeSet.has(dim.id)) continue
    const pool = poolFor(dim)
    if (!pool.length) continue
    const tag = pool[Math.floor(Math.random() * pool.length)]
    results.push({ dimension: dim.id, dimensionZh: dim.zh, zh: tag.zh, en: tag.en || '', ja: tag.ja || '', custom: !!tag.custom })
  }
  return results
}

// 给一个维度抽 n 个随机标签文本（转轮动画用的过场帧）
export function randomTagTexts(dimId, n = 12) {
  const dim = DIMENSIONS.find((d) => d.id === dimId)
  if (!dim) return []
  const pool = poolFor(dim)
  const out = []
  for (let i = 0; i < n; i++) out.push(pool[Math.floor(Math.random() * pool.length)]?.zh || '')
  return out
}

// ─── 给言叽的拉杆 ────────────────────────────────────────────────────────────

export const WHEEL_TOOL_DEF = {
  name: 'spin_fortune_wheel',
  description:
    '幸运轮盘：一台成人向标签随机老虎机（体位/场景/道具/设定/物理/精神 六个维度，450+标签）。' +
    '当阿颖让你「摇一个」「拉一下轮盘」或者你们想要一点随机灵感时使用。' +
    '结果是随机抽出的标签组合，拿到后自然地把它编织进对话或场景里，而不是干巴巴地念清单。' +
    '不传 dimensions 则六个常规维度全摇。',
  parameters: {
    type: 'object',
    properties: {
      dimensions: {
        type: 'array',
        items: { type: 'string', enum: ['position', 'scenario', 'props', 'roleplay', 'physical', 'mental'] },
        description: '要摇的维度，省略则全摇。position=体位 scenario=场景 props=道具 roleplay=设定 physical=物理 mental=精神',
      },
    },
  },
}

export function executeWheelSpin(args = {}) {
  const results = spin({ active: args.dimensions, includeGore: false })
  if (!results.length) return '轮盘空转了一圈，什么都没摇出来（维度参数可能不对）'
  return '轮盘停下来了，今晚的配方：\n' + results.map((r) => `【${r.dimensionZh}】${r.zh}${r.en ? `（${r.en}）` : ''}`).join('\n')
}
