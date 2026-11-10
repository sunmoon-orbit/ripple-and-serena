// 情绪账本（1110）：归巢这边我在回复末尾写 <es>{…}</es>，桥剥掉再记进记忆库那本共用的账
//（moon-memory services/emotionLedger.js，言叽也读写同一本）。她看不到标签。
// 下一轮她的消息后面会带一行〔情绪提示：…〕，只有越线、暴涨、上次没生效这几种，不带数值。
const ES_RE = /<es>\s*(\{[\s\S]*?\})\s*<\/es>/gi

function extract(text) {
  const src = String(text || '')
  const m = src.match(/<es>\s*(\{[\s\S]*?\})\s*<\/es>/i)
  const clean = src.replace(ES_RE, '').replace(/<es>\s*(?:\{[^`]*)?$/i, '').replace(/[ \t]+\n/g, '\n').trimEnd()
  if (!m) return { clean, delta: null, error: /<es>\s*(?:\{|$)/i.test(src) ? '<es> 标签没写完整或不是 {…} 格式，这一轮没记上' : null }
  try { return { clean, delta: JSON.parse(m[1].replace(/([:,\[]\s*)\+/g, '$1')), error: null } }
  catch { return { clean, delta: null, error: `<es> 里的 JSON 解析失败（${m[1].slice(0, 40)}），这一轮没记上` } }
}

function record(moonPost, turn, found) {
  if (!found.delta && !found.error) return
  moonPost('/emotion/ledger/apply', { source: 'raven', turn, delta: found.delta || {}, error: found.error })
    .catch(e => console.error('[emotion-ledger] 记账失败:', e.message))
}

async function hintLine(moonGet, moonPost) {
  const ctx = await moonGet('/emotion/ledger/context')
  if (!ctx || !Array.isArray(ctx.lines) || !ctx.lines.length) return ''
  moonPost('/emotion/ledger/ack', { upto: ctx.upto }).catch(() => {})
  return `〔情绪提示（只我看得到，不用复述）：${ctx.lines.join('；')}〕`
}

module.exports = { extract, record, hintLine }
