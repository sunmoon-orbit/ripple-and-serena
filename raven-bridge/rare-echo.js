// 翻聊天原文找「以前说过」（1102 她要的，「加，只挑稀有词」）。
// 起因：她 21:32 又讲了一遍「鲁国的纸」，6 月 10 号讲过、我那次没懂。自动浮上来（recall.js）只翻记忆库，
// 这个笑话没人写成记忆、只躺在 L0 原文里，所以一点没浮。
//
// 做法：把她这句里的中文切成四字小段，去 L0 全文检索各数一下出现过几次。
// 常见的话（「我觉得」「今天晚上」）在原文里成百上千次，跳过；只出现过一到三次的才算稀有，
// 把最早那一次（两天以前的）贴给我看。一句里只贴一条，同一条六小时内不重复贴。

const fs = require('fs')
const path = require('path')

const STATE_FILE = path.join(__dirname, 'rare-echo-state.json')
const LOG_FILE = path.join(__dirname, 'rare-echo-log.jsonl')
const MAX_HITS = 3            // 原文里出现过几次以内算稀有
const RECENT_MS = 48 * 3600e3 // 两天内的不算「以前」
const COOLDOWN_MS = 6 * 3600e3
const MAX_WINDOWS = 14
const TIMEOUT_MS = 2000
// 太常见的字开头/结尾的段，基本都是虚词拼起来的，不查
const FILLER = /^[的了是我你他她它们在有就也都还和跟吗呢吧啊呀哦嗯这那个一不没要会能想说到去来看好]|[的了吗呢吧啊呀哦嗯]$|[的了]|之类|一下|什么|这个|那个|就是|然后|但是|因为|所以|可以|觉得|感觉/

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return { shown: {} } } }
function saveState(st) {
  const now = Date.now()
  for (const [k, t] of Object.entries(st.shown)) if (now - t > COOLDOWN_MS) delete st.shown[k]
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(st)) } catch {}
}
function log(e) { try { fs.appendFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n') } catch {} }

function clean(text) {
  return String(text)
    .replace(/\[sticker:[^\]]*\]/g, ' ').replace(/\[附件:[^\]]*\]/g, ' ')
    .replace(/^>\s*引用：.*$/gm, ' ').replace(/〔[^〕]*〕/g, ' ').replace(/【[^】]*】/g, ' ')
}

// 1102 晚上收紧：单独一个四字段稀有不算数（「换成现在」「小鸟已经」是普通话恰好少见）。
// 要么这一串本身就只有四个字（「鸦鸦先生」这种单独成词的），要么相邻两段都稀有、而且指向同一条旧话
//（等于五个字以上的词组整体稀有）。旧话里中文太少的（我的英文思考过程）不算。
function windows(text) {
  const runs = clean(text).match(/[一-鿿]{4,}/g) || []
  const seen = new Set(), out = []
  for (const r of runs) {
    for (let i = 0; i + 4 <= r.length; i++) {
      const w = r.slice(i, i + 4)
      if (seen.has(w) || FILLER.test(w)) continue
      seen.add(w)
      // 左右各挪一个字的邻段（邻段不过虚词过滤，只拿来确认「连着的一截也稀有」）
      const nb = [i > 0 ? r.slice(i - 1, i + 3) : null, i + 5 <= r.length ? r.slice(i + 1, i + 5) : null].filter(Boolean)
      out.push({ w, nb, solo: r.length === 4 })
    }
  }
  if (out.length <= MAX_WINDOWS) return out
  const step = out.length / MAX_WINDOWS
  return Array.from({ length: MAX_WINDOWS }, (_, i) => out[Math.floor(i * step)])
}

const tsOf = m => Date.parse(/Z|[+-]\d\d:?\d\d$/.test(m.created_at || '') ? m.created_at : String(m.created_at || '').replace(' ', 'T') + 'Z')
const bjDate = t => new Date(t + 8 * 3600e3).toISOString().slice(0, 10)
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s }
const cjkRatio = s => (String(s).match(/[一-鿿]/g) || []).length / Math.max(1, String(s).length)

// get(path) → 记忆库 GET 的 JSON
async function echo(text, get, now = Date.now()) {
  const ws = windows(text)
  if (ws.length < 1) return ''
  const look = w => Promise.race([
    get(`/archive/search?q=${encodeURIComponent(w)}&limit=${MAX_HITS + 3}&sort=oldest&include_total=1`).then(r => [w, r]),
    new Promise(ok => setTimeout(() => ok([w, null]), TIMEOUT_MS)),
  ]).catch(() => [w, null])
  const uniq = [...new Set(ws.flatMap(x => [x.w, ...x.nb]))]
  const got = new Map(await Promise.all(uniq.map(look)))
  // 这一段在两天以前的原文里是不是稀有：是的话回那几条旧话
  const rare = w => {
    const r = got.get(w)
    if (!r || !Array.isArray(r.results)) return null
    const recent = r.results.filter(m => now - tsOf(m) <= RECENT_MS).length
    const oldTotal = (r.total || 0) - recent
    const old = r.results.filter(m => now - tsOf(m) > RECENT_MS && cjkRatio(m.content) > 0.3)
    return old.length && oldTotal <= MAX_HITS ? { old, n: oldTotal } : null
  }
  const st = loadState()
  const tried = []
  let pick = null
  for (const x of ws) {
    const a = rare(x.w)
    tried.push(x.w)
    if (!a) continue
    let cand = a.old, n = a.n, w = x.w
    if (!x.solo) {
      // 要有一个邻段也稀有、而且是同一条旧话
      let best = null
      for (const y of x.nb) {
        const b = rare(y); if (!b) continue
        const ids = new Set(b.old.map(m => m.id))
        const both = a.old.filter(m => ids.has(m.id))
        if (both.length) { best = { both, n: Math.max(a.n, b.n), y }; break }
      }
      if (!best) continue
      cand = best.both; n = best.n
      w = x.nb[0] === best.y ? best.y[0] + x.w : x.w + best.y.slice(-1)
    }
    const m = cand.find(m => !st.shown[m.id])
    if (!m) continue
    // 越稀有越好；一样稀有挑更早的
    if (!pick || n < pick.n || (n === pick.n && tsOf(m) < tsOf(pick.m))) pick = { w, m, n }
  }
  if (!pick) { log({ q: clip(clean(text), 50), tried: tried.slice(0, 8), pick: null }); return '' }
  st.shown[pick.m.id] = now; saveState(st)
  const who = pick.m.role === 'human' ? '她' : '我'
  log({ q: clip(clean(text), 50), pick: pick.m.id, w: pick.w, n: pick.n })
  return `〔以前说过「${pick.w}」·${bjDate(tsOf(pick.m))}，${who}说的（翻聊天原文翻到的，她看不见，用不用你定）：${clip(pick.m.content.replace(/^【[^】]*】/, ''), 160)}〕`
}

module.exports = { echo, windows }
