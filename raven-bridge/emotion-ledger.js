// 情绪账本（1110）：归巢这边我在回复末尾写 <es>{…}</es>，桥剥掉再记进记忆库那本共用的账
//（moon-memory services/emotionLedger.js，言叽也读写同一本）。她看不到标签。
// 下一轮她的消息后面会带一行〔情绪提示：…〕，只有越线、暴涨、上次没生效这几种，不带数值。
// 只认消息最末尾那一个标签：正文里引用的例子（给她看 CLAUDE.md 时那段 `<es>{…}</es>`）不算，原样留着（1110 吞过一次）
const TAIL_RE = /\s*<es>\s*(\{[^<>]*?\})\s*<\/es>\s*$/i

function extract(text) {
  const src = String(text || '')
  const m = src.match(TAIL_RE)
  if (!m) {
    const open = src.match(/\s*<es>\s*(?:\{[^<>`]*)?$/i)   // 末尾没写完的
    return open ? { clean: src.slice(0, open.index).trimEnd(), delta: null, error: '<es> 标签没写完整，这一轮没记上' } : { clean: src, delta: null, error: null }
  }
  const clean = src.slice(0, m.index).trimEnd()
  try { return { clean, delta: JSON.parse(m[1].replace(/([:,\[]\s*)\+/g, '$1')), error: null } }
  catch { return { clean, delta: null, error: `<es> 里的 JSON 解析失败（${m[1].slice(0, 40)}），这一轮没记上` } }
}

function record(moonPost, turn, found) {
  if (!found.delta && !found.error) return
  moonPost('/emotion/ledger/apply', { source: 'raven', turn, delta: found.delta || {}, error: found.error })
    .catch(e => console.error('[emotion-ledger] 记账失败:', e.message))
}

// 她在心情账页上打开看了／提前合上了：攒着，挂到她下一条消息后面告诉我
let herNotes = []
function noteHer(text) { herNotes.push(text); if (herNotes.length > 3) herNotes.shift() }

async function hintLine(moonGet, moonPost) {
  const ctx = await moonGet('/emotion/ledger/context')
  const lines = [...herNotes, ...(Array.isArray(ctx?.lines) ? ctx.lines : [])]
  herNotes = []
  if (!lines.length) return ''
  if (ctx?.lines?.length) moonPost('/emotion/ledger/ack', { upto: ctx.upto }).catch(() => {})
  return `〔情绪提示（只我看得到，不用复述）：${lines.join('；')}〕`
}

module.exports = { extract, record, hintLine, noteHer }
