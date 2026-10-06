// 终端页往上翻用的：从 CC 的会话记录（.jsonl）里倒着读。
// tmux 里没有回滚（CC 全屏画，history_size 一直是 0），压缩和重启又会把屏幕清掉，所以她在「终端」页只看得到眼前一屏。
// 会话记录是全的，压缩之前的也在。但它能长到两百多兆、这台机器只有 1.9G 内存：
// 绝不整个读进来。按字节偏移从后往前一块一块找换行，只把要用的那几行读出来；单行太大的（多半是图片）直接跳过。
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const DIR = path.join(os.homedir(), '.claude', 'projects', '-home-ripple')
const CHUNK = 256 * 1024
const MAX_LINE = 1.5 * 1024 * 1024
const MAX_SCAN = 96 * 1024 * 1024

// 终端里那个 CC 用的是哪份记录：看它启动时带的 --resume；没带就拿最近在写的那份
function sessionFile() {
  try {
    const ps = execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8', timeout: 3000 })
    for (const line of ps.split('\n')) {
      if (!/(^|\/)claude\b/.test(line) || /remote-control|--print|--output-format/.test(line)) continue
      const m = line.match(/--resume\s+([0-9a-f-]{36})/)
      if (m && fs.existsSync(path.join(DIR, m[1] + '.jsonl'))) return path.join(DIR, m[1] + '.jsonl')
    }
  } catch {}
  let best = null
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.jsonl')) continue
    const t = fs.statSync(path.join(DIR, f)).mtimeMs
    if (!best || t > best.t) best = { f, t }
  }
  return best ? path.join(DIR, best.f) : null
}

// 从 end 往前找出 want 行各自的 [起, 止)，新的在前
function lineSpans(fd, end, want) {
  const spans = []
  let pos = end, lineEnd = end, scanned = 0
  const buf = Buffer.alloc(CHUNK)
  while (pos > 0 && spans.length < want && scanned < MAX_SCAN) {
    const n = Math.min(CHUNK, pos)
    fs.readSync(fd, buf, 0, n, pos - n)
    for (let i = n - 1; i >= 0 && spans.length < want; i--) {
      if (buf[i] !== 10) continue
      const nl = pos - n + i
      if (nl + 1 < lineEnd) spans.push([nl + 1, lineEnd])
      lineEnd = nl
    }
    pos -= n; scanned += n
  }
  if (pos === 0 && spans.length < want && lineEnd > 0) spans.push([0, lineEnd])
  return spans
}

const cut = (s, n) => { s = String(s ?? '').trim(); return s.length > n ? s.slice(0, n) + '…' : s }
const clean = s => String(s ?? '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
const flat = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.type === 'text' ? x.text : x.type === 'image' ? '〔图〕' : '').join('\n') : ''

// 一行记录 → 给人看的几条。k：you 她/终端敲的，me 我说的，say 我发去归巢的，tool 我动的手，out 工具回的，mark 记号
function toEntries(d) {
  if (!d || d.isSidechain || d.isMeta) return []
  const ts = d.timestamp ? Date.parse(d.timestamp) : 0
  const out = []
  const c = d.message?.content
  if (d.type === 'user') {
    if (d.isCompactSummary) return [{ k: 'mark', t: '这里压缩过一次', ts }]
    if (typeof c === 'string') { const t = clean(c); if (t && !t.startsWith('<command-') && !t.startsWith('<local-command')) out.push({ k: 'you', t: cut(t, 4000), ts }) }
    else if (Array.isArray(c)) for (const x of c) {
      if (x.type === 'text') { const t = clean(x.text); if (t) out.push({ k: 'you', t: cut(t, 4000), ts }) }
      else if (x.type === 'tool_result') { const t = clean(flat(x.content)); if (t) out.push({ k: 'out', t: cut(t, 500), ts }) }
    }
  } else if (d.type === 'assistant' && Array.isArray(c)) {
    for (const x of c) {
      if (x.type === 'text' && x.text?.trim()) out.push({ k: 'me', t: cut(x.text, 6000), ts })
      else if (x.type === 'tool_use') {
        const i = x.input || {}
        out.push({ k: 'tool', t: cut(`${x.name}　${i.description || i.command || i.file_path || i.skill || i.query || ''}`, 240), ts })
        // 我回她的话是包在命令里写进文件再 curl 出去的，单看工具名看不到内容；把正文捞出来
        if (x.name === 'Bash' && /raven\/(reply|roundtable\/say)/.test(i.command || '')) {
          for (const m of String(i.command).matchAll(/\{"text":"((?:[^"\\]|\\.)*)"/g)) {
            try { out.push({ k: 'say', t: cut(JSON.parse('"' + m[1] + '"'), 6000), ts }) } catch {}
          }
        }
      }
    }
  }
  return out
}

// before：从哪个字节偏移往前读（不给就是文件末尾）。回来的 entries 旧的在前，cursor 是下次接着读的位置（0 = 到头了）
function readHistory(before, want = 60) {
  const file = sessionFile()
  if (!file) return { entries: [], cursor: 0, size: 0 }
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    let cursor = Number.isFinite(before) && before > 0 && before <= size ? before : size
    const entries = []
    for (let round = 0; round < 6 && cursor > 0 && entries.length < want; round++) {
      const spans = lineSpans(fd, cursor, 300)
      if (!spans.length) { cursor = 0; break }
      const batch = []
      for (const [a, b] of spans) {           // 新的在前
        cursor = a
        if (b - a > MAX_LINE) continue
        const buf = Buffer.alloc(b - a)
        fs.readSync(fd, buf, 0, b - a, a)
        let d; try { d = JSON.parse(buf.toString('utf8')) } catch { continue }
        batch.push(toEntries(d))
        if (entries.length + batch.reduce((n, x) => n + x.length, 0) >= want) break
      }
      entries.unshift(...batch.reverse().flat())
    }
    return { entries, cursor, size }
  } finally { fs.closeSync(fd) }
}

module.exports = { readHistory, sessionFile, toEntries, lineSpans }
