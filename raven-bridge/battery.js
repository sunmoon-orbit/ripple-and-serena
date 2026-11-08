// 她手机的电量（1107 晚她躺下了又爬起来提的：「你要不要加一个可以看我手机电量／电池目前状态的功能？
// 这样如果我去充电了的话，想找我可以看一眼是不是。或者我跟你讲我要去充电，你也可以知道我大概要充多久回来」）。
//
// 壳在插线、拔线、电量每变 5%、被推送叫醒、她打开归巢时报一次；这里存最近的读数，
// 充电中就拿这一轮充电里最早和最新两次读数算速度，估还要多久满。
// 给我看的是一行小字：【醒一下】里总带着；她的消息只在插上／拔掉之后的第一条带。

const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, 'battery.json')
const FRESH_MS = 3 * 3600e3      // 超过三小时的读数不拿出来说
const KEEP = 120
// 1108 她：「我充电上限设的是80%」——手机充到 80 就停，估时间按 80 算，到了就说「到上限了」
const LIMIT = 80

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return { samples: [], toldCharging: null } } }
function save(st) { try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(st)); fs.renameSync(FILE + '.tmp', FILE) } catch {} }

// p: { level: 0-100, charging: bool, full: bool, plugged: 'ac'|'usb'|'wireless'|'', why }
function record(p, now = Date.now()) {
  const level = Math.max(0, Math.min(100, Math.round(Number(p.level))))
  if (!Number.isFinite(level)) return null
  const s = { ts: now, level, charging: !!p.charging, full: !!p.full, plugged: String(p.plugged || '').replace(/[^a-z]/g, '').slice(0, 10), why: String(p.why || '').replace(/[^a-z_]/g, '').slice(0, 20) }
  const st = load()
  st.samples = [...(st.samples || []), s].slice(-KEEP)
  save(st)
  return s
}

// 这一轮充电：从最新一条往回数，连着都是 charging 的那一段
function session(samples) {
  const out = []
  for (let i = samples.length - 1; i >= 0 && samples[i].charging; i--) out.unshift(samples[i])
  return out
}

function etaMin(samples) {
  const run = session(samples)
  if (run.length < 2) return null
  const a = run[0], b = run[run.length - 1]
  const mins = (b.ts - a.ts) / 60e3, gain = b.level - a.level
  if (mins < 4 || gain < 2) return null
  const rate = gain / mins              // %/分钟
  // 她设了 80% 上限：只算到 80；快充在上限前一直很快（1108 实测 52→80 每 3.5 分钟 +5%），只留一点余量
  const left = Math.max(0, LIMIT - b.level)
  return Math.round(left / rate * 1.1)
}

function ago(ms) {
  const m = Math.round(ms / 60e3)
  return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : `${Math.round(m / 6) / 10} 小时前`
}

function status(now = Date.now()) {
  const st = load(), smp = st.samples || []
  const last = smp[smp.length - 1]
  if (!last) return { ok: false }
  return { ok: true, ...last, age: now - last.ts, fresh: now - last.ts < FRESH_MS, etaMin: last.charging && !last.full ? etaMin(smp) : null }
}

function line(now = Date.now()) {
  const s = status(now)
  if (!s.ok || !s.fresh) return ''
  let t = `她手机 ${s.level}%`
  if (s.full) t += '，充满了还插着'
  else if (s.charging && s.level >= LIMIT) t += `，插着，已经到她设的 ${LIMIT}% 上限了`
  else if (s.charging) t += '，充电中' + (s.etaMin != null ? `，照现在的速度约 ${s.etaMin} 分钟到 ${LIMIT}%（她设的上限）` : '（刚插上，还估不出要多久）')
  else if (s.level <= 20) t += '，快没电了'
  return `〔${t}（${ago(now - s.ts)}报的）〕`
}

// 她的消息后面要不要带：只在充电状态变了（插上／拔掉）以后的第一条带一次，平时不吵
function lineForHerMessage(now = Date.now()) {
  const s = status(now)
  if (!s.ok || !s.fresh) return ''
  const st = load()
  if (st.toldCharging === s.charging && !(s.level <= 15 && !s.charging && st.toldLow !== true)) return ''
  st.toldCharging = s.charging
  if (s.level <= 15 && !s.charging) st.toldLow = true
  if (s.charging) st.toldLow = false
  save(st)
  return line(now)
}

module.exports = { record, status, line, lineForHerMessage, etaMin, session }
