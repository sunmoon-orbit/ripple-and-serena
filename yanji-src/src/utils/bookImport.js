// 共读书架导书（1023）：TXT / EPUB / 文字型 PDF 都在她手机上解析，不经过任何模型；
// 中英对照时把英文版按章、按段配到中文段落下面（Gale–Church 那套按长度配对的思路）。

// 读 txt：先按 UTF-8 严格解码，失败退 GBK（国内 txt 大多是 GBK，直接 readAsText 会乱码）
async function readTxt(file) {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buf)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    const controls = bytes.slice(0, 4096).reduce((n, b) => n + (b < 32 && b !== 9 && b !== 10 && b !== 13 ? 1 : 0), 0)
    if (controls > Math.max(8, Math.min(bytes.length, 4096) * 0.02)) throw new Error('检测到二进制内容，不像是 TXT')
    return new TextDecoder('gbk').decode(buf)
  }
}

// EPUB：container.xml → opf → spine 顺序读每个 xhtml。
// 1029 她导的英文版只认出 2 章：整本书塞在一两个 xhtml 里、章名也不写 Chapter N。
// 所以不再「一个文件一章」，而是把全书段落连起来、按标题标签切；挑哪一级标题切，看哪一级切出来的像样章节最多。
const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TR', 'SECTION', 'ARTICLE', 'DD', 'DT'])
const HEAD_RE = /^H([1-6])$/
function htmlToItems(doc) {
  const out = []
  let buf = '', level = 0
  const flush = () => { const t = buf.replace(/\s+/g, ' ').trim(); if (t) out.push({ text: t, h: level }); buf = '' }
  const walk = (node, inHead) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) buf += n.nodeValue
      else if (n.nodeType === 1) {
        const tag = n.tagName.toUpperCase()
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'HEAD') continue
        if (tag === 'BR') { if (!inHead) flush(); else buf += ' '; continue }
        const hm = HEAD_RE.exec(tag)
        // 有的书用 <p class="chapter-title"> 之类当标题，认不全；先认 h1–h6
        if (hm) { flush(); level = +hm[1]; walk(n, true); flush(); level = 0; continue }
        const block = BLOCK_TAGS.has(tag)
        if (block && !inHead) flush()
        walk(n, inHead)
        if (block && !inHead) flush()
      }
    }
  }
  walk(doc.body || doc.documentElement, false)
  flush()
  return out
}

// 把全书条目按「≤lvl 级标题或文件开头」切成节。连着的几个标题合成一个章名（Chapter I + Mrs. Rachel Lynde Is Surprised）
function sectionize(docs, lvl) {
  const secs = []
  let cur = null
  const start = (title) => { cur = { titles: title ? [title] : [], paras: [] }; secs.push(cur) }
  for (const items of docs) {
    start('')
    for (const it of items) {
      if (it.h && it.h <= lvl && cur.paras.length) start(it.text)
      else if (it.h && !cur.paras.length) cur.titles.push(it.text)   // 节开头连着的标题（不管几级）都算章名
      else cur.paras.push(it.text)
    }
  }
  return secs
}

// 目录页：很多短行、没有一段像正文
function looksLikeToc(sec) {
  const t = sec.titles.join(' ')
  if (/^(contents|table of contents|目录|目次)$/i.test(t.trim())) return true
  const ps = sec.paras
  if (ps.length < 8) return false
  const short = ps.filter(p => p.length < 70).length
  return short / ps.length > 0.8 && Math.max(...ps.map(p => p.length)) < 220
}

async function readEpub(file) {
  const { default: JSZip } = await import('jszip')
  let zip
  try { zip = await JSZip.loadAsync(await file.arrayBuffer()) } catch { throw new Error('EPUB 打不开，文件可能坏了') }
  const read = async (p) => { const f = zip.file(p); if (!f) throw new Error('EPUB 里缺文件：' + p); return f.async('string') }
  const parser = new DOMParser()
  const container = parser.parseFromString(await read('META-INF/container.xml'), 'application/xml')
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path')
  if (!opfPath) throw new Error('EPUB 结构不认识')
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const opf = parser.parseFromString(await read(opfPath), 'application/xml')
  const manifest = {}
  for (const it of opf.querySelectorAll('manifest > item')) manifest[it.getAttribute('id')] = it.getAttribute('href')
  const title = opf.querySelector('metadata > title, title')?.textContent?.trim() || ''
  const author = opf.querySelector('metadata > creator, creator')?.textContent?.trim() || ''
  if (opf.querySelector('encryption') || zip.file('META-INF/encryption.xml')) {
    const enc = await zip.file('META-INF/encryption.xml')?.async('string')
    if (enc && /EncryptedData/.test(enc) && !/fonts?\//i.test(enc)) throw new Error('这本 EPUB 带版权加密（DRM），读不出正文')
  }
  const docs = []
  for (const ref of opf.querySelectorAll('spine > itemref')) {
    const href = manifest[ref.getAttribute('idref')]
    if (!href) continue
    const path = decodeURIComponent(base + href.split('#')[0])
    const f = zip.file(path)
    if (!f) continue
    const raw = await f.async('string')
    const doc = parser.parseFromString(raw, 'application/xhtml+xml')
    const html = doc.querySelector('parsererror') ? parser.parseFromString(raw, 'text/html') : doc
    docs.push(htmlToItems(html))
  }
  // 挑切分级别：像样的节（正文 ≥ 800 字）最多的那一级；一样多取更高一级（数字小）
  let best = null
  for (let lvl = 0; lvl <= 4; lvl++) {
    const secs = sectionize(docs, lvl)
    const good = secs.filter(s => s.paras.join('').length >= 800).length
    const titled = secs.filter(s => s.titles.length && s.paras.length).length
    if (!best || good > best.good || (good === best.good && titled > best.titled)) best = { lvl, secs, good, titled }
  }
  const chapters = best.secs
    .filter(s => s.paras.join('').replace(/\s/g, '').length >= 40 && !looksLikeToc(s))
    .map(s => ({ title: s.titles.join(' ').slice(0, 60), content: s.paras.join('\n') }))
  if (!chapters.length) throw new Error('EPUB 里没读到正文')
  // 标题不是 h 标签（有的书用加粗的 <p> 当章名）：章太少又很长，就退回按「第X章 / Chapter N」文字切一遍，切得多就用它
  const total = chapters.reduce((n, c) => n + c.content.length, 0)
  if (chapters.length < 3 && total > 30000) {
    const byText = splitChapters(chapters.map(c => (c.title ? c.title + '\n' : '') + c.content).join('\n'))
    if (byText.length > chapters.length) return { chapters: byText, title, author }
  }
  chapters.forEach((c, i) => { if (!c.title) c.title = `第 ${i + 1} 部分` })
  return { chapters, title, author }
}

// PDF：只收抽得出字的。按行的 y 坐标拼行，行距明显变大或首行缩进就断段
async function readPdf(file) {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  let pdf
  try { pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise } catch (e) {
    if (e?.name === 'PasswordException') throw new Error('这个 PDF 有密码，先解开再导')
    throw new Error('PDF 打不开，文件可能坏了')
  }
  const paras = []
  let chars = 0
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const tc = await page.getTextContent()
    const lines = []
    for (const it of tc.items) {
      if (!('str' in it)) continue
      const y = Math.round(it.transform[5]), x = it.transform[4], h = Math.abs(it.transform[3]) || it.height || 10
      const last = lines[lines.length - 1]
      if (last && Math.abs(last.y - y) < h * 0.5) { last.text += it.str; if (it.hasEOL) last.eol = true }
      else lines.push({ y, x, h, text: it.str, eol: it.hasEOL })
    }
    page.cleanup()
    const body = lines.filter(l => l.text.trim() && !/^\s*\d{1,4}\s*$/.test(l.text))   // 光秃秃的页码行丢掉
    if (!body.length) continue
    const minX = Math.min(...body.map(l => l.x))
    const lens = body.map(l => l.text.trim().length).sort((a, b) => a - b)
    const typical = lens[Math.floor(lens.length * 0.7)] || 1
    let cur = ''
    body.forEach((l, i) => {
      const prev = body[i - 1]
      const gap = prev ? prev.y - l.y : 0
      const indent = l.x - minX > l.h * 1.2
      // 断段：行距明显变大、首行缩进、或上一行以句末标点结尾且明显没写满
      const shortEnd = prev && /[。！？.!?」”"：:]$/.test(prev.text.trim()) && prev.text.trim().length < typical * 0.75
      const sizeJump = prev && Math.abs(l.h - prev.h) > prev.h * 0.15   // 字号变了多半是标题
      if (prev && (gap > prev.h * 1.8 || indent || shortEnd || sizeJump)) {
        if (cur.trim()) paras.push(cur.trim()); cur = ''
      }
      const t = l.text.trim()
      chars += t.length
      // 英文行尾断词的连字符接回去；英文行之间补空格，中文直接接
      if (cur && /[A-Za-z]-$/.test(cur)) cur = cur.slice(0, -1) + t
      else cur += (cur && /[A-Za-z0-9,;:.!?)]$/.test(cur) && /^[A-Za-z0-9(]/.test(t) ? ' ' : '') + t
    })
    if (cur.trim()) paras.push(cur.trim())
  }
  if (chars < Math.max(60, pdf.numPages * 30)) {
    const e = new Error('这是图片版 PDF（扫描的或者整页是图），抽不出字，进不了书架')
    e.imagePdf = true
    throw e
  }
  return { text: paras.join('\n'), title: '', author: '' }
}

export async function readBookFile(file) {
  const name = file.name || ''
  const head = new TextDecoder('latin1').decode(new Uint8Array(await file.slice(0, 8).arrayBuffer()))
  const base = name.replace(/\.(txt|text|md|markdown|epub|pdf)$/i, '').trim()
  if (/\.epub$/i.test(name) || head.startsWith('PK\u0003\u0004')) {
    const r = await readEpub(file)
    return { chapters: r.chapters, title: r.title || base, author: r.author }
  }
  if (/\.pdf$/i.test(name) || head.startsWith('%PDF-')) {
    const r = await readPdf(file)
    return { chapters: splitChapters(r.text), title: base, author: '' }
  }
  if (/\.(mobi|azw3?)$/i.test(name) || head.includes('BOOKMOBI')) throw new Error('MOBI/AZW 读不了，转成 EPUB 再来')
  const text = await readTxt(file)
  if (!text.trim()) throw new Error('文件是空的')
  return { chapters: splitChapters(text), title: base, author: '' }
}

// 自动分章：中文认行首「第X章/回/卷…」「序章/楔子/后记…」，英文认 Chapter/Part/Prologue…；没有就整本一章，超长按段落切块
const ZH_HEAD = '(?:第[0-9０-９一二两三四五六七八九十百千零〇]+[章回卷节集部篇])[^\\n]{0,30}|(?:序章|序言|楔子|引子|前言|后记|尾声|终章|番外)[^\\n]{0,20}'
const EN_HEAD = '(?:chapter|part|book)\\s+(?:[0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[a-z]+-?[a-z]*)\\b[^\\n]{0,50}|(?:prologue|epilogue|preface|foreword|introduction|afterword)\\b[^\\n]{0,40}'
export function splitChapters(raw) {
  const text = raw.replace(/\r\n?/g, '\n').replace(/　/g, ' ').trim()
  const re = new RegExp(`^[ \\t]*(${ZH_HEAD}|${EN_HEAD})[ \\t]*$`, 'gmi')
  const marks = [...text.matchAll(re)]
  if (marks.length < 2) return fallbackSplit(text)
  const chapters = []
  const head = text.slice(0, marks[0].index).trim()
  if (head) chapters.push({ title: '开篇', content: head })
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length
    const body = text.slice(m.index + m[0].length, end).trim()
    if (body) chapters.push({ title: m[1].trim(), content: body })
  })
  return chapters.length ? chapters : fallbackSplit(text)
}

function fallbackSplit(text) {
  const MAX = 12000
  if (text.length <= MAX) return [{ title: '全文', content: text }]
  const paras = text.split(/\n{2,}/).length > 3 ? text.split(/\n{2,}/) : text.split(/\n/)
  const parts = []
  let buf = [], len = 0
  for (const p of paras) {
    buf.push(p); len += p.length
    if (len >= 10000) { parts.push(buf.join('\n\n')); buf = []; len = 0 }
  }
  if (buf.length) parts.push(buf.join('\n\n'))
  return parts.map((c, i) => ({ title: `第 ${i + 1} 部分`, content: c }))
}

// 中文正文的段落：按换行切、去掉空段。阅读页插英文的位置也用同一个切法，两边必须一致
export function paragraphEnds(content) {
  const ends = []
  const re = /[^\n]*\S[^\n]*/g
  let m
  while ((m = re.exec(content))) ends.push(m.index + m[0].length)
  return ends
}
function paras(content) { return (content.match(/[^\n]*\S[^\n]*/g) || []).map(s => s.trim()) }

// 段落配对：动态规划，每一步可以 1-1、1-2、2-1、1-0、0-1、2-2，代价看两边长度比偏离全章平均比多少。
// 返回和中文段落一样长的数组，每格是配到这段下面的英文（可能是空串，也可能是两段英文接起来）
export function alignParagraphs(zh, en) {
  const n = zh.length, m = en.length
  if (!n) return []
  if (!m) return zh.map(() => '')
  // 两边段数差太多（章配错了、一边是整本）就别跑动态规划了，手机会卡死；按比例粗分
  if (m > n * 4 + 20 || n > m * 4 + 20 || n * m > 400000) return proportional(zh, en)
  const lz = zh.map(s => s.length + 1), le = en.map(s => s.length + 1)
  const ratio = le.reduce((a, b) => a + b, 0) / lz.reduce((a, b) => a + b, 0)
  const cost = (a, b) => { const x = Math.log((b + 1) / (ratio * a + 1)); return x * x * 4 }
  const MOVES = [[1, 1, 0], [1, 2, 0.6], [2, 1, 0.6], [2, 2, 1.2], [1, 0, 3], [0, 1, 3]]
  const INF = 1e18
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(INF))
  const B = Array.from({ length: n + 1 }, () => new Int8Array(m + 1).fill(-1))
  D[0][0] = 0
  const band = Math.max(20, Math.abs(n - m) + 20)
  for (let i = 0; i <= n; i++) {
    const center = Math.round(i * m / n)
    for (let j = Math.max(0, center - band); j <= Math.min(m, center + band); j++) {
      if (i === 0 && j === 0) continue
      for (let k = 0; k < MOVES.length; k++) {
        const [di, dj, pen] = MOVES[k]
        if (i < di || j < dj || D[i - di][j - dj] >= INF) continue
        let a = 0, b = 0
        for (let t = 1; t <= di; t++) a += lz[i - t]
        for (let t = 1; t <= dj; t++) b += le[j - t]
        const c = D[i - di][j - dj] + pen + (di && dj ? cost(a, b) : 0)
        if (c < D[i][j]) { D[i][j] = c; B[i][j] = k }
      }
    }
  }
  const out = zh.map(() => '')
  let i = n, j = m
  if (D[n][m] >= INF) return proportional(zh, en)
  while (i > 0 || j > 0) {
    const [di, dj] = MOVES[B[i][j]]
    const piece = en.slice(j - dj, j).join(' ')
    if (di && piece) out[i - 1] = out[i - 1] ? piece + '\n' + out[i - 1] : piece
    else if (!di && piece) { const t = Math.max(0, i - 1); out[t] = out[t] ? out[t] + '\n' + piece : piece }
    i -= di; j -= dj
  }
  return out
}

// 兜底：按累计长度比例把英文段分给中文段
function proportional(zh, en) {
  const tz = zh.reduce((a, s) => a + s.length, 0) || 1, te = en.reduce((a, s) => a + s.length, 0) || 1
  const out = zh.map(() => '')
  let acc = 0, zi = 0, zacc = zh[0].length / tz
  for (const s of en) {
    const mid = (acc + s.length / 2) / te
    while (zi < zh.length - 1 && mid > zacc) { zi++; zacc += zh[zi].length / tz }
    out[zi] = out[zi] ? out[zi] + '\n' + s : s
    acc += s.length
  }
  return out
}

// 上架预览只看前两对：缓存住，别每次界面刷新（打书名、点颜色）都重算（1029 她说卡）
let previewCache = null
export function previewPairs(zhChapters, enChapters, offset) {
  if (previewCache && previewCache.zh === zhChapters && previewCache.en === enChapters && previewCache.off === offset) return previewCache.result
  const start = Math.max(0, -offset)
  const zh = zhChapters.slice(start, start + 2)
  const result = zh.map((c, i) => {
    const e = enChapters[start + i + offset]
    if (!e) return { ...c, alt: null, alt_title: '' }
    return { ...c, alt: alignParagraphs(paras(c.content).slice(0, 12), paras(e.content).slice(0, 40)), alt_title: e.title || '' }
  })
  previewCache = { zh: zhChapters, en: enChapters, off: offset, result }
  return result
}

// 整本配对：中文第 i 章配英文第 i+offset 章；英文多出来的章接到最后一章后面不管，少了就空着
export function pairBooks(zhChapters, enChapters, offset = 0) {
  return zhChapters.map((c, i) => {
    const e = enChapters[i + offset]
    if (!e) return { ...c, alt: null, alt_title: '' }
    return { ...c, alt: alignParagraphs(paras(c.content), paras(e.content)), alt_title: e.title || '' }
  })
}

// 两本书章节数差得多，猜一个最可能的起始偏移：试 -3..3，选前几章长度比最稳的那个
export function guessOffset(zhChapters, enChapters) {
  let best = 0, bestScore = Infinity
  for (let off = -3; off <= 3; off++) {
    const rs = []
    for (let i = 0; i < Math.min(zhChapters.length, 12); i++) {
      const e = enChapters[i + off]
      if (!e) continue
      rs.push(Math.log((e.content.length + 1) / (zhChapters[i].content.length + 1)))
    }
    if (rs.length < Math.min(3, zhChapters.length)) continue
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length
    const v = rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length + Math.abs(off) * 0.01
    if (v < bestScore) { bestScore = v; best = off }
  }
  return best
}
