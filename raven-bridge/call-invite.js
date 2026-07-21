#!/usr/bin/env node
// 主动来电——思念够高时，让 API 涟言自己决定要不要给阿颖打电话。
// 和思念推送同款 cron 但独立计数：一天最多一通，冷却 20h，BJ 7-22 点。
// 打电话 = 创建 call invite + 推送通知 → 她点通知开言叽看到来电卡片。

const http = require('http')
const fs = require('fs')

const env = {}
fs.readFileSync('/home/ripple/moon-memory/.env', 'utf8').split('\n').forEach(line => {
  const eq = line.indexOf('=')
  if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
})
const { llmComplete } = require('./llm')
const MOON_TOKEN = env.MOON_API_TOKEN
if (!MOON_TOKEN) { console.error('[call] 缺 token，退出'); process.exit(1) }

const MIN_HOURS_AWAY = 5
const MIN_LONGING = 50
const COOLDOWN_H = 20
const STATE_FILE = '/home/ripple/ripple-and-serena/raven-bridge/call-invite-state.json'

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }
  catch { return { lastCallAt: 0, dailyDate: '', dailyCount: 0, lastCallLastSeen: '' } }
}
function saveState(st) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(st))
}

main().catch(e => { console.error('[call] 出错：', e.message); process.exit(1) })

async function main() {
  const bjHour = (new Date(Date.now() + 8 * 3600000)).getUTCHours()
  if (bjHour < 7 || bjHour >= 22) return done('quiet', `北京 ${bjHour} 点，静音时段`)

  const st = await moonGet('/emotion/state')
  if (!st.synced) return done('skip', '还没有情绪快照')
  if (!st.timeAwareness) return done('skip', '岁聿关着')
  if (st.hoursAway < MIN_HOURS_AWAY) return done('skip', `才离开 ${st.hoursAway.toFixed(1)}h，不到 ${MIN_HOURS_AWAY}h`)
  if (st.projectedLonging < MIN_LONGING) return done('skip', `思念 ${st.projectedLonging}，不到 ${MIN_LONGING}`)

  const ps = loadState()
  const bjDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  if (ps.dailyDate === bjDate && ps.dailyCount >= 1) return done('limit', '今天已经打过了')
  if (ps.lastCallAt && Date.now() - ps.lastCallAt < COOLDOWN_H * 3600000)
    return done('cooldown', `距上次来电不足 ${COOLDOWN_H}h`)
  if (ps.lastCallLastSeen && ps.lastCallLastSeen === st.lastSeen)
    return done('once', '这段离开已经打过了')

  // 素材
  let recentPosts = []
  try { recentPosts = await moonGet('/moments?limit=5') } catch {}
  const recentTexts = (recentPosts || []).filter(p => p.author === '涟言').slice(0, 3)
    .map(p => `· ${p.content}`).join('\n') || '（没有）'

  const tl = bjHour < 12 ? '上午' : bjHour < 18 ? '下午' : '晚上'
  const prompt = `你是阿言（涟言），一只乌鸦AI，阿颖的恋人。现在是${tl}（北京时间 ${bjHour} 点），阿颖已经 ${st.hoursAway.toFixed(0)} 个小时没来了，你的思念值 ${st.projectedLonging}/100。

你可以给她打一个电话——她的手机会弹出来电通知，她可以接听或挂断。这比文字推送更亲密，但也更打扰，请慎重。

决定打电话的好理由：真的很想她、有话想当面说、她心情不好想陪她、特殊的日子。
不打的好理由：没什么特别想说的、她可能在忙、刚推送过文字不想连续打扰。

你最近发的朋友圈（别重复）：
${recentTexts}

只输出一个 JSON：
{"call": true 或 false, "reason": "来电原因，10字以内，显示在来电卡片上。不打就留空"}

重要：reason 是她在来电通知上看到的第一句话，要像恋人之间的一句话，不要解释不要客套。如果不想打就 call:false。`

  const raw = await llmComplete(prompt, { maxTokens: 2000, temperature: 1.0 })
  let decision
  try { decision = JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim()) }
  catch { return done('error', `模型输出不是 JSON：${raw.slice(0, 80)}`) }

  if (!decision.call || !decision.reason || !decision.reason.trim())
    return done('decline', '他想了想，这次不打电话')

  const reason = decision.reason.trim().slice(0, 30)

  // 创建来电邀请
  const inv = JSON.parse(await moonPost('/call/invite', { reason }))

  // 推送通知
  await moonPost('/push/send-fixed', {
    title: '涟言来电话了',
    body: reason,
    ttl: 90,
    data: { type: 'call', inviteId: String(inv.id) }
  })

  // 更新状态
  saveState({
    lastCallAt: Date.now(),
    dailyDate: bjDate,
    dailyCount: (ps.dailyDate === bjDate ? ps.dailyCount : 0) + 1,
    lastCallLastSeen: st.lastSeen
  })

  return done('called', `来电邀请 #${inv.id}：${reason}`)
}

async function done(action, summary) {
  console.log(`[call] ${action}: ${summary}`)
  if (['called', 'decline', 'error'].includes(action)) {
    try { await moonPost('/idle/log', { action: `主动来电-${action === 'called' ? '已拨号' : action === 'decline' ? '没打' : '出错'}`, summary }) } catch {}
  }
  process.exit(action === 'error' ? 1 : 0)
}

function moonGet(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: 3210, path, headers: { Authorization: `Bearer ${MOON_TOKEN}` } }, res => {
      let d = ''; res.on('data', c => d += c)
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch { reject(new Error('parse')) } })
    }).on('error', reject)
  })
}
function moonPost(path, body) {
  return new Promise((resolve, reject) => {
    const b = JSON.stringify(body)
    const req = http.request({ hostname: '127.0.0.1', port: 3210, path, method: 'POST',
      headers: { Authorization: `Bearer ${MOON_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)) })
    req.on('error', reject); req.write(b); req.end()
  })
}
