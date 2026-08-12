// 验证 OpenAI 兼容格式的显式缓存点真的落在稳定历史上，而不是每轮变化的实时上下文里。
import fs from 'fs'
import vm from 'vm'

const src = fs.readFileSync(new URL('../src/api/llm.js', import.meta.url), 'utf8')

function grab(name) {
  const start = src.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`找不到 ${name}`)
  const lineStart = src.lastIndexOf('\n', start) + 1
  let depth = 0
  let i = src.indexOf('{', src.indexOf(') {', start))
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) break }
  }
  return src.slice(lineStart, i + 1)
}

const ctx = {
  redactDeep: (value) => JSON.parse(JSON.stringify(value)),
}
vm.createContext(ctx)
vm.runInContext([
  grab('getOpenAICacheHintMode'),
  grab('isOpenAICacheableMessage'),
  grab('markOpenAICacheBreakpoint'),
  grab('addOpenAICacheBreakpoints'),
  grab('buildOpenAIMessages'),
  '__fns = { getOpenAICacheHintMode, addOpenAICacheBreakpoints, buildOpenAIMessages };',
].join('\n\n'), ctx)

const { getOpenAICacheHintMode, addOpenAICacheBreakpoints, buildOpenAIMessages } = ctx.__fns
let pass = 0
let fail = 0
const check = (name, condition, detail = '') => {
  if (condition) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}

console.log('模型缓存协议识别：')
check('OpenAI 格式的 Claude 克隆走 cache_control', getOpenAICacheHintMode('ver-ant-0.05-sonnet') === 'anthropic')
check('正式 Claude 名称走 cache_control', getOpenAICacheHintMode('claude-sonnet-4-6') === 'anthropic')
check('GPT-5.6 走官方显式断点', getOpenAICacheHintMode('gpt-5.6') === 'openai')
check('旧 GPT 保留原有自动缓存', getOpenAICacheHintMode('gpt-5.2') === null)
check('其他兼容模型不盲加字段', getOpenAICacheHintMode('deepseek-v4') === null)

const firstMessages = [
  { role: 'user', content: '第一问' },
  { role: 'assistant', content: '第一答' },
  { role: 'user', content: '第二问' },
]
const secondMessages = [
  ...firstMessages,
  { role: 'assistant', content: '第二答' },
  { role: 'user', content: '第三问' },
]
const firstBase = buildOpenAIMessages(firstMessages, '固定系统提示', '当前时间：10点')
const secondBase = buildOpenAIMessages(secondMessages, '固定系统提示', '当前时间：11点')
const first = addOpenAICacheBreakpoints(firstBase, 'anthropic')
const second = addOpenAICacheBreakpoints(secondBase, 'anthropic')

console.log('滚动缓存前缀：')
check('上一轮写点在下一轮仍是完全相同的前缀',
  JSON.stringify(first.slice(0, 3)) === JSON.stringify(second.slice(0, 3)))
check('系统提示有稳定断点', first[0]?.content?.[0]?.cache_control?.type === 'ephemeral')
check('上一轮助手消息有写断点', first[2]?.content?.[0]?.cache_control?.type === 'ephemeral')
check('下一轮新助手消息成为新写点', second[4]?.content?.[0]?.cache_control?.type === 'ephemeral')
check('实时上下文只在当前 user', second[5]?.content.includes('当前时间：11点'))
check('当前动态 user 没有缓存断点', typeof second[5]?.content === 'string')
check('添加断点不修改基础请求', typeof firstBase[0]?.content === 'string' && typeof firstBase[2]?.content === 'string')

const official = addOpenAICacheBreakpoints(secondBase, 'openai')
console.log('OpenAI 官方断点：')
check('使用 prompt_cache_breakpoint', official[4]?.content?.[0]?.prompt_cache_breakpoint?.mode === 'explicit')
check('不会混入 Anthropic cache_control', !official[4]?.content?.[0]?.cache_control)

console.log(`\n通过 ${pass}，失败 ${fail}`)
process.exit(fail ? 1 : 0)
