// 界面写的是「轮数」，[MSG] 拆出的多个助手气泡不能各算一轮。
import fs from 'fs'
import vm from 'vm'

const src = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8')
const name = 'limitMessagesForContext'
const start = src.indexOf(`function ${name}(`)
if (start === -1) throw new Error(`找不到 ${name}`)
const lineStart = src.lastIndexOf('\n', start) + 1
let depth = 0
let end = src.indexOf('{', src.indexOf(') {', start))
for (; end < src.length; end++) {
  if (src[end] === '{') depth++
  else if (src[end] === '}') { depth--; if (depth === 0) break }
}

const ctx = { estimateTokens: (text) => String(text || '').length / 4 }
vm.createContext(ctx)
vm.runInContext(`${src.slice(lineStart, end + 1)}\n__fn = ${name}`, ctx)
const limit = ctx.__fn

const makeRounds = (count) => Array.from({ length: count }, (_, i) => [
  { id: `u${i}`, role: 'user', content: `问${i}` },
  { id: `a${i}-1`, role: 'assistant', content: `答${i}-1`, thinking: '想' },
  { id: `a${i}-2`, role: 'assistant', content: `答${i}-2` },
  { id: `a${i}-3`, role: 'assistant', content: `答${i}-3` },
]).flat()

let pass = 0
let fail = 0
const check = (name, condition, detail = '') => {
  if (condition) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}
const cfg = { mode: 'rounds', maxRounds: 40 }

const forty = makeRounds(40)
check('40 个真实 user 轮次不会被拆分气泡误裁', limit(forty, cfg).length === forty.length)

const fortyOne = makeRounds(41)
const limited41 = limit(fortyOne, cfg)
check('跨界后从完整 user 轮次开始', limited41[0]?.role === 'user')
check('锚点按 10 个真实轮次移动', limited41[0]?.id === 'u10', limited41[0]?.id)
check('41 轮跨界后保留 31 个真实轮次', limited41.filter((m) => m.role === 'user').length === 31)

const sameTurnLonger = [...fortyOne, { role: 'assistant', content: '又一个气泡' }]
check('同一轮多一个 assistant 气泡不移动裁剪前缀', limit(sameTurnLonger, cfg)[0]?.id === 'u10')

const fifty = limit(makeRounds(50), cfg)
check('到 50 轮时仍用同一锚点并保留 40 轮', fifty[0]?.id === 'u10' && fifty.filter((m) => m.role === 'user').length === 40)

console.log(`\n通过 ${pass}，失败 ${fail}`)
process.exit(fail ? 1 : 0)
