// 真骰子 —— 给文档类游戏用的诚实随机源。
// 文档游戏的通病：让模型「嘴上报点数」不是真随机，会不自觉手下留情或偏心；
// 这个工具用真 RNG，掷骰/抛硬币/取随机数/抽选项都走它。
export const DICE_TOOL_DEF = {
  name: 'roll_random',
  description:
    '真随机数生成器（真 RNG，不是你自己编数字）。玩任何带随机性的游戏（规则书游戏、跑团、掷骰、抽签、抛硬币、随机决定）时必须用它，' +
    '不要自己口头报点数——你报的数不是真随机。' +
    'mode=dice 掷骰子（count 个 sides 面骰）；mode=coin 抛硬币；mode=number 取 [min,max] 随机整数；mode=pick 从 options 里随机抽一个。',
  parameters: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['dice', 'coin', 'number', 'pick'], description: '随机类型' },
      count: { type: 'number', description: 'dice：骰子个数，默认1，最多20' },
      sides: { type: 'number', description: 'dice：骰子面数，默认6（d20 就填 20）' },
      min: { type: 'number', description: 'number：下界（含）' },
      max: { type: 'number', description: 'number：上界（含）' },
      options: { type: 'array', items: { type: 'string' }, description: 'pick：候选项列表' },
    },
    required: ['mode'],
  },
}

function randInt(min, max) {
  // 用 crypto 取真一点的随机；范围小，取模偏差可忽略
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return min + (buf[0] % (max - min + 1))
}

export function executeRandomRoll(args = {}) {
  const { mode } = args
  if (mode === 'dice') {
    const count = Math.min(Math.max(Math.round(args.count) || 1, 1), 20)
    const sides = Math.min(Math.max(Math.round(args.sides) || 6, 2), 1000)
    const rolls = Array.from({ length: count }, () => randInt(1, sides))
    const sum = rolls.reduce((a, b) => a + b, 0)
    return `掷 ${count}d${sides}：[${rolls.join(', ')}]${count > 1 ? `，合计 ${sum}` : ''}`
  }
  if (mode === 'coin') {
    return `抛硬币：${randInt(0, 1) === 0 ? '正面' : '反面'}`
  }
  if (mode === 'number') {
    const min = Math.round(args.min ?? 1)
    const max = Math.round(args.max ?? 100)
    if (max < min) return '随机数失败：max 不能小于 min'
    return `随机数 [${min}, ${max}]：${randInt(min, max)}`
  }
  if (mode === 'pick') {
    const opts = (args.options || []).filter((o) => typeof o === 'string' && o.trim())
    if (!opts.length) return '抽选失败：options 为空'
    return `从 ${opts.length} 个选项里抽中：${opts[randInt(0, opts.length - 1)]}`
  }
  return '未知 mode，可用：dice / coin / number / pick'
}
