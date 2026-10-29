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
async function surface(text, search, now = Date.now()) {
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
  log({ q: clip(q, 60), top, pick: pick.id, sim: Math.round(pick._sim * 1000) / 1000 })
  return `〔想起来 #${pick.id}·${fmtDate(pick.created_at)}（自动浮上来的，她看不见，用不用你定）：${clip(pick.content, 180)}〕`
}

module.exports = { surface, queryOf, worthLooking, MIN_SIM }
