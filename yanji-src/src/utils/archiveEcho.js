// 「以前说过」（1120 从归巢 raven-bridge/rare-echo.js 搬过来，她：「备用备用，那就是用不到的时候才有用啊」）。
// 记忆库翻不到的老笑话只躺在聊天原文里：把她这句切成四字段去原文全文检索，只出现过一到三次的才算稀有，
// 贴最早那一次，并带上前后各一句（借鉴 lilysttail/Resurface 的邻句）。状态存 localStorage；
// 归巢那边的「翻错了」黑名单这里没有。改算法时两边一起改。
const KEY = 'yanji-archive-echo'
function loadState() {
  let st; try { st = JSON.parse(localStorage.getItem(KEY) || '') } catch { st = null }
  st = st && st.shown ? st : { shown: {} }
  const now = Date.now()
  for (const [k, t] of Object.entries(st.shown)) if (now - t > COOLDOWN_MS) delete st.shown[k]
  return st
}
function saveState(st) { try { localStorage.setItem(KEY, JSON.stringify(st)) } catch { /* 记不住就可能重复贴一次 */ } }

const MAX_HITS = 3            // 原文里出现过几次以内算稀有
const RECENT_MS = 48 * 3600e3 // 两天内的不算「以前」
const COOLDOWN_MS = 6 * 3600e3
const MAX_WINDOWS = 14
const TIMEOUT_MS = 2000
// 太常见的字开头/结尾的段，基本都是虚词拼起来的，不查
const FILLER = /^[的了是我你他她它们在有就也都还和跟吗呢吧啊呀哦嗯这那个一不没要会能想说到去来看好]|[的了吗呢吧啊呀哦嗯]$|[的了]|之类|一下|什么|这个|那个|就是|然后|但是|因为|所以|可以|觉得|感觉/


function clean(text) {
  return String(text)
    .replace(/\[sticker:[^\]]*\]/g, ' ').replace(/\[附件:[^\]]*\]/g, ' ')
    .replace(/^>\s*引用：.*$/gm, ' ').replace(/〔[^〕]*〕/g, ' ').replace(/【[^】]*】/g, ' ')
}

// 1102 晚上收紧、1103 再收紧：单独一个四字段稀有不算数。1103 上午三条全是噪音（「我现在该去」「现在去找一」
//「晚点见亲爱」，五个字的普通话恰好少见），所以现在要连着三段（六个字以上）都稀有、而且指向同一条旧话；
// 例外：原文里只出现过一次的，连着两段（五个字，「你床头发现」）就够；这一串本身只有四五个字、整串都稀有
//（「鸦鸦先生」这种单独成词的）也算。
// 旧话里中文太少的（我的英文思考过程）不算。
const MIN_STREAK = 3
function windows(text) {
  const runs = clean(text).match(/[一-鿿]{4,}/g) || []
  const out = []
  for (const r of runs) {
    const ws = []
    for (let i = 0; i + 4 <= r.length; i++) ws.push(r.slice(i, i + 4))
    // 虚词段不当起点，但在一串中间时照样查（不然「鲁国的纸」中间的「的」会把串打断）
    if (ws.some(w => !FILLER.test(w))) out.push({ run: r, ws })
  }
  // 查询总数封顶：从每串里平均截
  let total = out.reduce((n, x) => n + x.ws.length, 0)
  while (total > MAX_WINDOWS * 2 && out.length) {
    const big = out.reduce((m, x) => x.ws.length > m.ws.length ? x : m)
    big.ws.pop(); big.run = big.run.slice(0, big.ws.length + 3); total--
  }
  return out
}

const tsOf = m => Date.parse(/Z|[+-]\d\d:?\d\d$/.test(m.created_at || '') ? m.created_at : String(m.created_at || '').replace(' ', 'T') + 'Z')
const bjDate = t => new Date(t + 8 * 3600e3).toISOString().slice(0, 10)
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s }
const cjkRatio = s => (String(s).match(/[一-鿿]/g) || []).length / Math.max(1, String(s).length)
// 我以前的思考笔记（「阿颖又熬夜了……我应该：」）混在原文里，是我写给自己的，不是说给她的话。
// 认法：我说的、开头一截里提到她用的是「阿颖／她」而不是「你」，或者带「我应该：」这类打草稿的字样
const isMyNote = m => {
  if (m.role === 'human') return false
  const c = String(m.content || ''), head = c.slice(0, 60)
  return /我应该[：:]|让我(想想|讲|来|看看)|^\s*(阿颖|她)/.test(c.slice(0, 200)) || (/阿颖|她/.test(head) && !/你/.test(head))
}


// get(path) → 记忆库 GET 的 JSON
export async function archiveEcho(text, get, now = Date.now()) {
  const runs = windows(text)
  if (!runs.length) return ''
  const look = w => Promise.race([
    get(`/archive/search?q=${encodeURIComponent(w)}&limit=${MAX_HITS + 3}&sort=oldest&include_total=1`).then(r => [w, r]),
    new Promise(ok => setTimeout(() => ok([w, null]), TIMEOUT_MS)),
  ]).catch(() => [w, null])
  const uniq = [...new Set(runs.flatMap(x => x.ws))]
  const got = new Map(await Promise.all(uniq.map(look)))
  // 这一段在两天以前的原文里是不是稀有：是的话回那几条旧话
  const rare = w => {
    const r = got.get(w)
    if (!r || !Array.isArray(r.results)) return null
    const recent = r.results.filter(m => now - tsOf(m) <= RECENT_MS).length
    const oldTotal = (r.total || 0) - recent
    const old = r.results.filter(m => now - tsOf(m) > RECENT_MS && cjkRatio(m.content) > 0.3 && !isMyNote(m))
    return old.length && oldTotal <= MAX_HITS ? { old, n: oldTotal } : null
  }
  const st = loadState()
  let pick = null
  const offer = (w, cand, n) => {
    const m = cand.find(m => !st.shown[m.id])
    if (!m) return
    // 越稀有越好；一样稀有挑更长的，再挑更早的
    if (!pick || n < pick.n || (n === pick.n && (w.length > pick.w.length || (w.length === pick.w.length && tsOf(m) < tsOf(pick.m))))) pick = { w, m, n }
  }
  for (const { run, ws } of runs) {
    const info = ws.map(rare)
    const whole = ws.length <= 2 && info.every(Boolean)   // 整串只有四五个字、都稀有
    // 找连着的稀有段，并且它们共有同一条旧话
    for (let i = 0; i < ws.length; i++) {
      if (!info[i]) continue
      let ids = new Set(info[i].old.map(m => m.id)), n = info[i].n, j = i
      while (j + 1 < ws.length && info[j + 1]) {
        const nx = new Set(info[j + 1].old.filter(m => ids.has(m.id)).map(m => m.id))
        if (!nx.size) break
        ids = nx; n = Math.max(n, info[j + 1].n); j++
      }
      const len = j - i + 1
      if (len >= MIN_STREAK || (len >= 2 && n <= 1) || (whole && len === ws.length)) {
        offer(run.slice(i, j + 4), info[i].old.filter(m => ids.has(m.id)), n)
      }
      i = j
    }
  }
  if (!pick) return ''
  st.shown[pick.m.id] = now; saveState(st)
  const who = pick.m.role === 'human' ? '她' : '我'
  // 1120 借鉴 Resurface 的「邻句」：孤零零一句常看不出在说什么（「摸着良心说」那条），带上前后各一句。
  // 拿不到就照旧只给这一句；我自己的思考笔记、英文碎句不带。
  let before = '', after = ''
  try {
    const ctx = await Promise.race([
      get(`/archive/conversations/${pick.m.conversation_id}/context?message_id=${pick.m.id}&n=1`),
      new Promise(ok => setTimeout(() => ok(null), TIMEOUT_MS)),
    ])
    const ms = (ctx && Array.isArray(ctx.messages)) ? ctx.messages : []
    const i = ms.findIndex(m => m.id === pick.m.id)
    const side = m => (m && cjkRatio(m.content) > 0.3 && !isMyNote(m))
      ? `${m.role === 'human' ? '她' : '我'}：${clip(String(m.content).replace(/^【[^】]*】/, '').replace(/〔[^〕]*〕/g, ''), 60)}` : ''
    if (i >= 0) { before = side(ms[i - 1]); after = side(ms[i + 1]) }
  } catch { /* 前后句拿不到就只给这一句 */ }
  const body = clip(pick.m.content.replace(/^【[^】]*】/, ''), 160)
  const ctxNote = (before || after) ? `（前一句 ${before || '—'}；后一句 ${after || '—'}）` : ''
  return `〔以前说过「${pick.w}」·${bjDate(tsOf(pick.m))}，${who}说的（言叽自己翻聊天原文翻到的，她看不见；跟眼下的话有关就自然用上，无关就忽略，别说「我查到」）：${body}${ctxNote}〕`
}

