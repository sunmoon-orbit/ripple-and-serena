// 从 llm.js 里抠出真实的 streamGeminiParts 函数体来测，不测复制品。
import fs from 'fs'
import vm from 'vm'

const src = fs.readFileSync(new URL('../src/api/llm.js', import.meta.url), 'utf8')

function grab(name) {
  const start = src.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`找不到 ${name}`)
  // 从函数名往前退到行首（可能有 async / 注释）
  let s = src.lastIndexOf('\n', start) + 1
  if (src.slice(s, start).trim() === 'async') s = src.lastIndexOf('\n', s - 2) + 1
  let depth = 0, i = src.indexOf('{', start)
  const from = i
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) break }
  }
  return src.slice(s, i + 1)
}

const ctx = { console, TextDecoder }
vm.createContext(ctx)
vm.runInContext([
  src.match(/^const SENTINEL_RE = .*$/m)[0],
  grab('stripSentinel'),
  grab('warnBadEvent'),
  grab('badEventNote'),
  grab('streamGeminiParts'),
  '__fn = streamGeminiParts;',
].join('\n\n'), ctx)
const streamGeminiParts = ctx.__fn

// 把若干字符串块伪装成 resp.body.getReader()
function fakeResp(chunks) {
  const enc = new TextEncoder()
  let i = 0
  return { body: { getReader: () => ({
    read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true }),
  }) } }
}
const ev = (o) => `data: ${JSON.stringify(o)}\n\n`

let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}  ${extra}`) }
}

// ── 1. 核心回归：两个不同工具，各自在自己的事件里，下标都是 0 ────────────
{
  const resp = fakeResp([
    ev({ candidates: [{ content: { parts: [{ functionCall: { name: 'browse_moments', args: { limit: 3 } } }] } }] }),
    ev({ candidates: [{ content: { parts: [{ functionCall: { name: 'go_fishing', args: { bait: '虫' } } }] }, finishReason: 'STOP' }] }),
  ])
  const d = await streamGeminiParts(resp, () => {})
  const fcs = d.candidates[0].content.parts.filter((p) => p.functionCall).map((p) => p.functionCall)
  console.log('用例1 两个不同工具下标都是 0：')
  check('没被合并成一个', fcs.length === 2, `实际 ${fcs.length} 个`)
  check('第一个工具名完整', fcs[0]?.name === 'browse_moments', fcs[0]?.name)
  check('第二个工具名没被拼接', fcs[1]?.name === 'go_fishing', fcs[1]?.name)
  check('参数没被搅在一起', JSON.stringify(fcs[0]?.args) === '{"limit":3}', JSON.stringify(fcs[0]?.args))
}

// ── 2. 同一个工具重发完整 part（中转站重复）→ 应合并成一个，参数不重复 ──
{
  const resp = fakeResp([
    ev({ candidates: [{ content: { parts: [{ functionCall: { name: 'go_fishing', args: { bait: '虫' } } }] } }] }),
    ev({ candidates: [{ content: { parts: [{ functionCall: { name: 'go_fishing', args: { bait: '虫' } } }] } }] }),
  ])
  const d = await streamGeminiParts(resp, () => {})
  const fcs = d.candidates[0].content.parts.filter((p) => p.functionCall)
  console.log('用例2 同一工具被重发：')
  check('合并成一个', fcs.length === 1, `实际 ${fcs.length}`)
  check('参数没被拼成「虫虫」', fcs[0]?.functionCall.args.bait === '虫', fcs[0]?.functionCall.args.bait)
}

// ── 3. 文本边收边吐 + 跨 TCP 分包的半行 ───────────────────────────────
{
  const whole = ev({ candidates: [{ content: { parts: [{ text: '好的，' }] } }] })
    + ev({ candidates: [{ content: { parts: [{ text: '我看看。' }] }, finishReason: 'STOP' }] })
  const cut = Math.floor(whole.length / 2)
  const got = []
  const d = await streamGeminiParts(fakeResp([whole.slice(0, cut), whole.slice(cut)]), (t) => got.push(t))
  console.log('用例3 文本 + 半行分包：')
  check('分两次吐给 UI', got.length === 2, JSON.stringify(got))
  check('拼起来完整', d.candidates[0].content.parts.map((p) => p.text || '').join('') === '好的，我看看。')
  check('finishReason 拿到了', d.candidates[0].finishReason === 'STOP')
}

// ── 4. 坏事件要记账，不能静默吞 ────────────────────────────────────────
{
  const d = await streamGeminiParts(fakeResp([
    ev({ candidates: [{ content: { parts: [{ text: '在的' }] } }] }),
    'data: {坏掉的JSON\n\n',
  ]), () => {})
  const all = d.candidates[0].content.parts.map((p) => p.text || '').join('')
  console.log('用例4 畸形事件：')
  check('正文保留', all.includes('在的'))
  check('末尾有警告', all.includes('没解析出来'), all)
}

// ── 5. usage 是累计值不是增量，多次出现应覆盖而不是相加 ─────────────────
{
  const d = await streamGeminiParts(fakeResp([
    ev({ candidates: [{ content: { parts: [{ text: 'a' }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 5 } }),
    ev({ candidates: [{ content: { parts: [{ text: 'b' }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 12 } }),
  ]), () => {})
  console.log('用例5 usage 覆盖而非累加：')
  check('prompt 是 100 不是 200', d.usageMetadata.promptTokens === 100, String(d.usageMetadata.promptTokens))
  check('completion 取最后一次 12', d.usageMetadata.completionTokens === 12, String(d.usageMetadata.completionTokens))
}

// ── 6. 安全层整条拦下 ─────────────────────────────────────────────────
{
  const d = await streamGeminiParts(fakeResp([ev({ promptFeedback: { blockReason: 'SAFETY' } })]), () => {})
  console.log('用例6 blockReason：')
  check('捕获到 SAFETY', d.promptFeedback?.blockReason === 'SAFETY')
  check('正文为空', d.candidates[0].content.parts.length === 0)
}

console.log(`\n通过 ${pass}，失败 ${fail}`)
process.exit(fail ? 1 : 0)
