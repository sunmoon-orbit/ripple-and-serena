// 真回溯（1006）：替她去按 Claude Code 自己的回溯菜单，把涟言的对话倒回到她选的那一条之前。
// 文件一律不倒——菜单里带「code」的两项永远不碰；默认光标就停在「代码和对话一起倒」上，
// 所以这里从不在确认页按回车，只找到写着「Restore conversation」的那一行，按它前面的数字。
// 每一步都先看屏幕再动手；看不懂就退出菜单、原样报错，宁可不倒也不乱按。
const { execFileSync } = require('child_process')

const sleep = ms => new Promise(r => setTimeout(r, ms))
const tmux = (...args) => execFileSync('tmux', args, { encoding: 'utf8', timeout: 4000 })
const screen = target => tmux('capture-pane', '-p', '-t', target)
const key = (target, ...keys) => tmux('send-keys', '-t', target, ...keys)
const squash = s => String(s).replace(/\s+/g, '')

// 菜单画在屏幕最下面，所以只看最后一个「Rewind」标题往下的部分，免得聊天内容里的同样字眼骗过去
function menu(target) {
  const lines = screen(target).split('\n')
  const at = lines.map(l => l.trim()).lastIndexOf('Rewind')
  return at < 0 ? null : lines.slice(at + 1)
}
const inList = m => m && m.some(l => /Enter to continue/.test(l))
const inConfirm = m => m && m.some(l => /^\s*(❯\s*)?\d\. Restore conversation\s*$/.test(l))
const selected = m => { const l = (m || []).find(l => /^\s*❯ /.test(l)); return l ? l.replace(/^\s*❯ /, '').trim() : null }

async function bail(target) {
  for (let i = 0; i < 3 && menu(target); i++) { key(target, 'Escape'); await sleep(500) }
}

// needle：那条消息在终端里的开头（列表里长消息会被截断，所以只比开头）
// verify：确认页上必须出现的一段字（用它分辨开头相同的几条，比如带时间戳的结尾）
// skip：开头和 verify 都一样的消息有好几条时（比如连着几个「哼」），从新往旧跳过前几条
async function rewindPane(target, { needle, verify, skip = 0, maxSteps = 300 }) {
  const want = squash(needle)
  if (want.length < 2) return { ok: false, error: 'needle too short' }
  if (menu(target)) return { ok: false, error: '回溯菜单已经开着' }
  key(target, '-l', '/rewind'); await sleep(500); key(target, 'Enter'); await sleep(1200)
  if (!inList(menu(target))) { await bail(target); return { ok: false, error: '没能打开回溯菜单' } }

  let prev = null
  for (let step = 0; step < maxSteps; step++) {
    key(target, 'Up'); await sleep(180)
    const m = menu(target)
    if (!inList(m)) { await bail(target); return { ok: false, error: '菜单中途不见了' } }
    const sel = selected(m)
    const more = m.some(l => /↑ \d+ more above/.test(l))
    if (sel === prev && !more) break   // 到顶了
    prev = sel
    const got = squash((sel || '').replace(/…$/, ''))
    const n = Math.min(got.length, want.length)
    if (n < Math.min(6, want.length) || got.slice(0, n) !== want.slice(0, n)) continue
    // 开头对上了：进确认页看全文
    key(target, 'Enter'); await sleep(900)
    const c = menu(target)
    if (!inConfirm(c)) { await bail(target); return { ok: false, error: '确认页长得不认识' } }
    if (verify && !squash(c.join('')).includes(squash(verify))) { key(target, 'Escape'); await sleep(600); continue }   // 同样开头的另一条，回列表接着往上
    if (skip > 0) { skip--; key(target, 'Escape'); await sleep(600); continue }
    const row = c.find(l => /^\s*(❯\s*)?\d\. Restore conversation\s*$/.test(l))
    const digit = row.match(/(\d)\. Restore conversation/)[1]
    key(target, digit); await sleep(1800)
    if (menu(target)) { await bail(target); return { ok: false, error: '按了之后菜单没关' } }
    // 回溯后原话会回到输入框里，清掉（长消息折成好几行，多清几次）
    for (let i = 0; i < 6; i++) { key(target, 'C-u'); await sleep(120) }
    return { ok: true, steps: step + 1 }
  }
  await bail(target)
  return { ok: false, error: 'not-found' }
}

module.exports = { rewindPane }
