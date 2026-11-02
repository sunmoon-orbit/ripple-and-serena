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
const FILLER = /^[的了是我你他她它们在有就也都还和跟吗呢吧啊呀哦嗯这那个一不没要会能想说到去来看好]|[的了吗呢吧啊呀哦嗯]$/

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

function windows(text) {
  const runs = clean(text).match(/[一-鿿]{4,}/g) || []
  const seen = new Set(), out = []
  for (const r of runs) for (let i = 0; i + 4 <= r.length; i++) {
    const w = r.slice(i, i + 4)
    if (seen.has(w) || FILLER.test(w)) continue
    seen.add(w); out.push(w)
  }
  if (out.length <= MAX_WINDOWS) return out
  const step = out.length / MAX_WINDOWS
  return Array.from({ length: MAX_WINDOWS }, (_, i) => out[Math.floor(i * step)])
}

const tsOf = m => Date.parse(/Z|[+-]\d\d:?\d\d$/.test(m.created_at || '') ? m.created_at : String(m.created_at || '').replace(' ', 'T') + 'Z')
const bjDate = t => new Date(t + 8 * 3600e3).toISOString().slice(0, 10)
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s }

// get(path) → 记忆库 GET 的 JSON
async function echo(text, get, now = Date.now()) {
  const ws = windows(text)
  if (ws.length < 1) return ''
  const results = await Promise.all(ws.map(w => Promise.race([
    get(`/archive/search?q=${encodeURIComponent(w)}&limit=${MAX_HITS + 3}&sort=oldest&include_total=1`).then(r => ({ w, r })),
    new Promise(ok => setTimeout(() => ok({ w, r: null }), TIMEOUT_MS)),
  ]).catch(() => ({ w, r: null }))))
  const st = loadState()
  const tried = []
  let pick = null
  for (const { w, r } of results) {
    if (!r || !Array.isArray(r.results)) continue
    const old = r.results.filter(m => now - tsOf(m) > RECENT_MS)
    const recent = (r.total || 0) - old.length
    const oldTotal = (r.total || 0) - Math.max(0, recent)
    tried.push([w, r.total || 0])
    if (!old.length || oldTotal > MAX_HITS) continue
    const m = old[0]
    if (st.shown[m.id]) continue
    // 越稀有越好；一样稀有挑更早的
    if (!pick || oldTotal < pick.n || (oldTotal === pick.n && tsOf(m) < tsOf(pick.m))) pick = { w, m, n: oldTotal }
  }
  if (!pick) { log({ q: clip(clean(text), 50), tried: tried.slice(0, 8), pick: null }); return '' }
  st.shown[pick.m.id] = now; saveState(st)
  const who = pick.m.role === 'human' ? '她' : '我'
  log({ q: clip(clean(text), 50), pick: pick.m.id, w: pick.w, n: pick.n })
  return `〔以前说过「${pick.w}」·${bjDate(tsOf(pick.m))}，${who}说的（翻聊天原文翻到的，她看不见，用不用你定）：${clip(pick.m.content.replace(/^【[^】]*】/, ''), 160)}〕`
}

module.exports = { echo, windows }
