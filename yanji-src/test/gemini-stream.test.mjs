// 从 llm.js 里抠出真实的流解析/判错函数来测，不测复制品。
import fs from 'fs'
import vm from 'vm'

const src = fs.readFileSync(new URL('../src/api/llm.js', import.meta.url), 'utf8')

function grab(name) {
  const start = src.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`找不到 ${name}`)
  // 从函数名往前退到行首（可能有 async / 注释）
  let s = src.lastIndexOf('\n', start) + 1
  if (src.slice(s, start).trim() === 'async') s = src.lastIndexOf('\n', s - 2) + 1
  // 不能拿函数名后的第一个 `{`：参数可能是对象解构（例如
  // `fn(result, { provider })`），那会把参数的右花括号误认成函数结尾。
  let depth = 0, i = src.indexOf('{', src.indexOf(') {', start))
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) break }
  }
  return src.slice(s, i + 1)
}

const ctx = { console, TextDecoder, redactSecrets: (value) => value }
vm.createContext(ctx)
vm.runInContext([
  src.match(/^const SENTINEL_RE = .*$/m)[0],
  src.match(/^const RESPONSE_DIAGNOSTIC_MAX = .*$/m)[0],
  src.match(/^const EMPTY_NOTE_RE = .*$/m)[0],
  src.match(/^const PROVIDER_LABEL = .*$/m)[0],
  grab('stripSentinel'),
  grab('releaseSentinelSafe'),
  grab('readSseData'),
  grab('sanitizeResponseDiagnostic'),
  grab('mergeResponseDiagnostic'),
  grab('attachResponseMetadata'),
  grab('warnBadEvent'),
  grab('badEventNote'),
  grab('emptyReplyError'),
  grab('incompleteReplyError'),
  grab('assertStreamComplete'),
  grab('hasNamedCompatibilityError'),
  grab('isPromptCacheKeyCompatibilityError'),
  grab('isToolsCompatibilityError'),
  grab('parseProviderHttpMessage'),
  grab('providerRequestSummary'),
  grab('providerHttpError'),
  grab('streamGeminiParts'),
  grab('streamSSE'),
  '__fns = { streamGeminiParts, streamSSE, assertStreamComplete, sanitizeResponseDiagnostic, isPromptCacheKeyCompatibilityError, isToolsCompatibilityError, providerHttpError };',
].join('\n\n'), ctx)
const {
  streamGeminiParts,
  streamSSE,
  assertStreamComplete,
  sanitizeResponseDiagnostic,
  isPromptCacheKeyCompatibilityError,
  isToolsCompatibilityError,
  providerHttpError,
} = ctx.__fns

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

// ── 7. 合法 SSE 可以没有 data 后空格，也可以用 CRLF ───────────────────
{
  const got = []
  const payload = JSON.stringify({ choices: [{ delta: { content: '没漏字' } }] })
  const d = await streamSSE(
    fakeResp([`data:${payload}\r\n\r\ndata:[DONE]\r\n\r\n`]),
    (json) => json.choices?.[0]?.delta?.content,
    (text) => got.push(text),
  )
  console.log('用例7 SSE 空格与 CRLF 兼容：')
  check('正文解析成功', d.text === '没漏字', d.text)
  check('终止事件被识别', d.streamComplete === true, String(d.streamComplete))
  check('UI 收到增量', got.join('') === '没漏字', JSON.stringify(got))
}

// ── 8. 回调里的编程错误必须冒出去，不能伪装成「坏数据包」──────────────
{
  let thrown = null
  try {
    await streamSSE(
      fakeResp([ev({ value: 'hello' }), 'data: [DONE]\n\n']),
      () => { throw new TypeError('callback exploded') },
      () => {},
    )
  } catch (error) { thrown = error }
  console.log('用例8 回调异常：')
  check('真实异常没有被吞', thrown?.message === 'callback exploded', thrown?.message)
}

// ── 9. 半句断流要报错，并把已收到的 usage 带给上层记账 ────────────────
{
  let thrown = null
  const partial = {
    text: '只收到半句',
    usage: { promptTokens: 100, completionTokens: 8, totalTokens: 108 },
    streamComplete: false,
  }
  try { assertStreamComplete(partial, { provider: 'OpenAI' }) } catch (error) { thrown = error }
  console.log('用例9 半句断流：')
  check('判为 connection closed', /connection closed/i.test(thrown?.message || ''), thrown?.message)
  check('usage 没丢', thrown?.usage?.totalTokens === 108, JSON.stringify(thrown?.usage))
}

// ── 10. 400 兼容重试只能在错误明确点名字段时触发 ──────────────────────
{
  console.log('用例10 OpenAI 400 回退判据：')
  check('明确拒绝 prompt_cache_key 会回退', isPromptCacheKeyCompatibilityError("Unknown parameter: 'prompt_cache_key'"))
  check('仅 unsupported model 不会重复请求', !isPromptCacheKeyCompatibilityError('This model is unsupported'))
  check('明确不支持 tool calls 会回退', isToolsCompatibilityError('This model does not support tool calls'))
  check('无关 invalid request 不会删工具重试', !isToolsCompatibilityError('Invalid request: model is offline'))
}

// ── 11. 正常响应没有诊断字段时不能再因 undefined.replace 崩溃 ─────────
{
  console.log('用例11 空诊断：')
  check('undefined 安全返回空串', sanitizeResponseDiagnostic(undefined) === '')
}

// ── 12. 上游 429 不能伪装成前端崩溃，也不能在气泡里铺满追踪号 ────────
{
  const requestId = '202608120407539932196948268d9d6VCkWU3VP'
  const raw = JSON.stringify({ error: { message: `暂不可用，请切换模型，小梦加速修复中(${requestId})`, type: 'rate_limited' } })
  const error = providerHttpError('OpenAI', 429, raw, {
    model: 'ver-ant-test', messages: [{ role: 'user', content: '不应进入诊断' }],
    tools: [{ type: 'function' }], stream: true, max_tokens: 4096,
    user: 'secret-chat-id', prompt_cache_key: 'secret-chat-id',
  })
  console.log('用例12 OpenAI 429 诊断：')
  check('明确标成上游错误', error.isProviderError === true && error.status === 429)
  check('气泡不展示长追踪号', !error.message.includes(requestId), error.message)
  check('说明没有自动重试', error.message.includes('未自动重试'), error.message)
  check('诊断保留上游追踪号', error.responseDiagnostic.includes(requestId))
  check('诊断只有请求轮廓，不含消息正文和路由键值',
    error.responseDiagnostic.includes('messages: 1') &&
    error.responseDiagnostic.includes('tools: 1') &&
    !error.responseDiagnostic.includes('不应进入诊断') &&
    !error.responseDiagnostic.includes('secret-chat-id'))
}

console.log(`\n通过 ${pass}，失败 ${fail}`)
process.exit(fail ? 1 : 0)
