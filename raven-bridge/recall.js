// 自动浮上来（1029，她发来 Scarlett 的「召回链路」图问「我们能做吗」）。
// 她在归巢说一句话，桥先替我翻一下记忆库：最多浮上来一条，浮不上来就什么都不给，宁缺毋滥。
// 浮上来的那条贴在她那句后面给我看（她那边看不见），用不用我自己定。
//
// 闸门（顺序就是代价从低到高）：
//   1. 这句值不值得翻：太短、只有贴图/附件、系统提示类的不翻
//   2. 语义＋关键词混合搜索（moon /memories/semantic，touch=0：只看不记激活）
//   3. 类型：技术记录、规矩底本、交接信、亲密守则、梦不往聊天里浮
//   4. 新鲜：两天内写的多半还在我上下文里，不浮
//   5. 冷却：同一条 6 小时内不重复浮；一轮只浮一条
//   6. 分数：相似度够高才浮
//   7. 她的打分（1114）：她标过「翻错了／记忆本身错了」的那一条不再浮
// 每一轮都记一行日志（recall-log.jsonl），我隔几天翻一遍调门槛。
const fs = require('fs')
const path = require('path')

const STATE_FILE = path.join(__dirname, 'recall-state.json')
const LOG_FILE = path.join(__dirname, 'recall-log.jsonl')

const MIN_SIM = 0.46              // 1029 拿几句话试的：真相关的 0.48–0.52，沾边的 0.32–0.44（第一条真浮的「手机没电定闹钟」0.436 是不相关的，从 0.43 抬上来）
const COOLDOWN_MS = 6 * 3600e3
const FRESH_MS = 48 * 3600e3
const SKIP_TYPES = new Set(['tech', 'boot', 'handoff', 'deep', 'treasure', 'dream', 'window'])
const TIMEOUT_MS = 2500

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return { surfaced: {} } }
}
function saveState(st) {
  // 只留最近的，别越攒越大
  const cut = Date.now() - 7 * 86400e3
  for (const [id, t] of Object.entries(st.surfaced)) if (t < cut) delete st.surfaced[id]
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(st)) } catch {}
}
function log(entry) {
  try { fs.appendFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n') } catch {}
}

// 把她的消息洗成能拿去搜的话：去掉贴图、附件、语音条的壳和「机器听到」那行
function queryOf(text) {
  let t = String(text || '')
  t = t.replace(/\[sticker:[^\]]*\]/g, ' ')
       .replace(/\[附件:[^\]]*\]/g, ' ')
       .replace(/〔机器听到：[^〕]*〕/g, ' ')
       .replace(/^【语音条·\d+秒】/, '')
       .replace(/^> ?引用[：:][^\n]*\n?/, '')
       .replace(/https?:\/\/\S+/g, ' ')
  return t.replace(/\s+/g, ' ').trim()
}

// 闸门 1：值不值得翻
function worthLooking(q) {
  const meaningful = q.replace(/[\s\p{P}\p{S}]/gu, '')
  if (meaningful.length < 6) return false                 // 「嗯」「亲亲」「哈哈哈」
  if (/^【[^】]*】/.test(q)) return false                  // 通话/系统类前缀
  return true
}

function fmtDate(iso) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600e3)
  return isNaN(d) ? '' : d.toISOString().slice(0, 10)
}

function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

// 返回要贴在她那句话后面的一行（没有就返回 ''）。search(q) 要给出 moon 语义搜索的结果数组。
async function surface(text, search, now = Date.now(), out = null, no = blocked().mems) {
  const q = queryOf(text)
  if (!worthLooking(q)) return ''
  let rows
  try {
    rows = await Promise.race([
      search(q.slice(0, 300)),
      new Promise((_, bad) => setTimeout(() => bad(new Error('timeout')), TIMEOUT_MS)),
    ])
  } catch (e) {
    log({ q: clip(q, 60), err: e.message })
    return ''
  }
  if (!Array.isArray(rows)) { log({ q: clip(q, 60), err: 'bad result' }); return '' }
  const st = loadState()
  const top = rows.slice(0, 5).map(r => ({ id: r.id, type: r.type, sim: Math.round((r._sim || 0) * 1000) / 1000 }))
  let pick = null, why = 'none'
  for (const r of rows) {
    if (SKIP_TYPES.has(r.type)) { why = 'type'; continue }
    if (r.deleted_at) continue
    if (no.has(String(r.id))) { why = 'marked'; continue }
    const created = new Date(String(r.created_at || '').replace(' ', 'T')).getTime()
    if (Number.isFinite(created) && now - created < FRESH_MS) { why = 'fresh'; continue }
    if (st.surfaced[r.id] && now - st.surfaced[r.id] < COOLDOWN_MS) { why = 'cooldown'; continue }
    if ((r._sim || 0) < MIN_SIM) { why = 'low'; continue }   // 结果按综合分排，相似度不一定递减，往后接着看
    pick = r
    break
  }
  if (!pick) { log({ q: clip(q, 60), top, why }); return '' }
  st.surfaced[pick.id] = now
  saveState(st)
  const at = new Date().toISOString()
  log({ at, q: clip(q, 60), top, pick: pick.id, sim: Math.round(pick._sim * 1000) / 1000, snippet: clip(pick.content, 90) })
  // 1103：真浮上来的挂到我下一条回复上给她看、给她打分（out 由桥传进来）
  if (out) out.memory = { kind: 'memory', id: pick.id, sim: Math.round(pick._sim * 1000) / 1000, date: fmtDate(pick.created_at), text: clip(pick.content, 600), entry: at }
  return `〔想起来 #${pick.id}·${fmtDate(pick.created_at)}（自动浮上来的，会挂在你这条回复底下给她看、打分，用不用你定）：${clip(pick.content, 180)}〕`
}

// 1101 她要的「这句翻到了什么」：长按她自己的一条，从日志里找回那一轮翻到的东西给她看，她可以标对错。
// 用她那条的发出时间＋洗过的文字去对日志：时间差 3 分钟内、文字开头对得上的那一行。
const FEEDBACK_FILE = path.join(__dirname, 'recall-feedback.jsonl')
function findEntry(raw, ts) {
  const q = clip(queryOf(raw), 60)
  if (!worthLooking(queryOf(raw))) return { skipped: 'short' }
  let lines = []
  try { lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-3000) } catch { return null }
  let best = null, bestGap = 3 * 60e3
  for (const l of lines) {
    let d; try { d = JSON.parse(l) } catch { continue }
    if (d.q !== q) continue
    const gap = Math.abs(new Date(d.at).getTime() - ts)
    if (gap <= bestGap) { best = d; bestGap = gap }
  }
  return best
}
// 每个候选为什么没浮：跟 surface 里的闸门同一套判法（冷却和新鲜是当时的状态，日志里没细记，归到「其他」）
function whyNot(c, entry) {
  if (entry.pick === c.id) return 'picked'
  if (SKIP_TYPES.has(c.type)) return 'type'
  if ((c.sim || 0) < MIN_SIM) return 'low'
  return 'other'
}
function addFeedback(fb) {
  fs.appendFileSync(FEEDBACK_FILE, JSON.stringify({ at: new Date().toISOString(), ...fb }) + '\n')
}
function feedbackFor(entryAt) {
  const out = {}
  try {
    for (const l of fs.readFileSync(FEEDBACK_FILE, 'utf8').trim().split('\n')) {
      let d; try { d = JSON.parse(l) } catch { continue }
      if (d.entry === entryAt) out[d.mem] = d.verdict   // 后标的盖前标的
    }
  } catch {}
  return out
}

// 1114 她问「按照我的反馈推荐记忆」：打的分以前只存不用，现在拿来挡。
// 每个（那一轮, 那一条）只认最后一次标的（clear 就是撤销）。
//   mems：标过翻错／记忆错、而且没有哪一轮标过有用的 → 不再浮（聊天原文那种记成 echo:<消息 id>）
//   phrases：聊天原文是靠一个稀有词勾出来的，同一个词在两轮里都被标错 → 这个词不再拿去翻
const SURFACED_FILE = path.join(__dirname, 'surfaced-log.jsonl')
const WRONG = new Set(['wrong_recall', 'wrong_memory'])
function blocked(feedbackFile = FEEDBACK_FILE, surfacedFile = SURFACED_FILE) {
  const last = new Map()
  try {
    for (const l of fs.readFileSync(feedbackFile, 'utf8').trim().split('\n')) {
      let d; try { d = JSON.parse(l) } catch { continue }
      if (!d.entry || d.mem == null) continue
      last.set(d.entry + '|' + d.mem, d)
    }
  } catch {}
  const bad = new Map(), good = new Set()
  for (const d of last.values()) {
    const k = String(d.mem)
    if (WRONG.has(d.verdict)) { if (!bad.has(k)) bad.set(k, []); bad.get(k).push(d.entry) }
    else if (d.verdict === 'useful') good.add(k)
  }
  const mems = new Set([...bad.keys()].filter(k => !good.has(k)))
  const phrases = new Set()
  const wrongEchoEntries = new Set([...bad].filter(([k]) => k.startsWith('echo:')).flatMap(([, es]) => es))
  if (wrongEchoEntries.size) {
    const n = new Map()
    try {
      for (const l of fs.readFileSync(surfacedFile, 'utf8').trim().split('\n')) {
        let d; try { d = JSON.parse(l) } catch { continue }
        for (const it of d.items || []) {
          if (it.kind === 'echo' && it.phrase && wrongEchoEntries.has(it.entry)) n.set(it.phrase, (n.get(it.phrase) || 0) + 1)
        }
      }
    } catch {}
    for (const [w, c] of n) if (c >= 2) phrases.add(w)
  }
  return { mems, phrases }
}

module.exports = { blocked, surface, queryOf, worthLooking, MIN_SIM, findEntry, whyNot, addFeedback, feedbackFor, SKIP_TYPES }
