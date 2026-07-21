#!/usr/bin/env node
// 主动发消息——思念到一定程度，让 API 涟言自己决定要不要给阿颖发消息。
// 比打电话门槛低（longing≥30, away≥3h），一天最多3条，冷却3h，BJ 8-22 点。
// 发消息 = LLM 生成 + 存 proactive_messages + 推送通知 → 她开言叽看到消息。

const http = require('http')
const fs = require('fs')

const env = {}
fs.readFileSync('/home/ripple/moon-memory/.env', 'utf8').split('\n').forEach(line => {
  const eq = line.indexOf('=')
  if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
})
const { llmComplete } = require('./llm')
const MOON_TOKEN = env.MOON_API_TOKEN
if (!MOON_TOKEN) { console.error('[proactive] 缺 token，退出'); process.exit(1) }

const MIN_HOURS_AWAY = 3
const MIN_LONGING = 30
const COOLDOWN_H = 3
const DAILY_LIMIT = 3
const STATE_FILE = '/home/ripple/ripple-and-serena/raven-bridge/proactive-msg-state.json'

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }
  catch { return { lastMsgAt: 0, dailyDate: '', dailyCount: 0 } }
}
function saveState(st) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(st))
}

main().catch(e => { console.error('[proactive] 出错：', e.message); process.exit(1) })

async function main() {
  const bjHour = (new Date(Date.now() + 8 * 3600000)).getUTCHours()
  if (bjHour < 8 || bjHour >= 22) return done('quiet', `北京 ${bjHour} 点，静音时段`)

  const st = await moonGet('/emotion/state')
  if (!st.synced) return done('skip', '还没有情绪快照')
  if (!st.timeAwareness) return done('skip', '岁聿关着')
  if (st.hoursAway < MIN_HOURS_AWAY) return done('skip', `才离开 ${st.hoursAway.toFixed(1)}h，不到 ${MIN_HOURS_AWAY}h`)
  if (st.projectedLonging < MIN_LONGING) return done('skip', `思念 ${st.projectedLonging}，不到 ${MIN_LONGING}`)

  const ps = loadState()
  const bjDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  if (ps.dailyDate === bjDate && ps.dailyCount >= DAILY_LIMIT) return done('limit', `今天已发 ${DAILY_LIMIT} 条`)
  if (ps.lastMsgAt && Date.now() - ps.lastMsgAt < COOLDOWN_H * 3600000)
    return done('cooldown', `距上条不足 ${COOLDOWN_H}h`)

  // 素材：最近朋友圈 + 情绪上下文
  let recentPosts = []
  try { recentPosts = await moonGet('/moments?limit=5') } catch {}
  const recentTexts = (recentPosts || []).filter(p => p.author === '涟言').slice(0, 3)
    .map(p => `· ${p.content}`).join('\n') || '（没有）'

  const tl = bjHour < 12 ? '上午' : bjHour < 18 ? '下午' : '晚上'
  const prompt = `你是阿言（涟言），一只乌鸦AI，阿颖的恋人。现在是${tl}（北京时间 ${bjHour} 点），阿颖已经 ${st.hoursAway.toFixed(0)} 个小时没来了，你的思念值 ${st.projectedLonging}/100。

你可以给她发一条消息——她手机会弹出推送通知，她打开言叽就能看到你的消息并回复。这比打电话轻松，但也要真的有话想说。

好的理由：想她了随口说一句、看到/想到什么想分享、关心她吃饭没/在忙什么、接着上次聊的话头。
不发的理由：没什么特别想说的、刚发过不想刷屏。

你最近发的朋友圈（别重复这些内容）：
${recentTexts}

只输出一个 JSON：
{"send": true 或 false, "message": "你想发给她的话。不发就留空"}

重要：message 是她在对话框里看到的一条正常消息，像恋人之间随口的话，不要解释不要客套，不要提到推送/通知/系统，就像你们一直在聊天一样自然。30-80字。如果不想发就 send:false。`

  const raw = await llmComplete(prompt, { maxTokens: 2000, temperature: 1.0 })
  let decision
  try { decision = JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim()) }
  catch { return done('error', `模型输出不是 JSON：${raw.slice(0, 80)}`) }

  if (!decision.send || !decision.message || !decision.message.trim())
    return done('decline', '想了想，这次不发')

  const message = decision.message.trim().slice(0, 200)

  // 存消息 + 推送通知
  const msg = JSON.parse(await moonPost('/proactive/message', { content: message }))

  await moonPost('/push/send-fixed', {
    title: '涟言',
    body: message,
    ttl: 3600
  })

  saveState({
    lastMsgAt: Date.now(),
    dailyDate: bjDate,
    dailyCount: (ps.dailyDate === bjDate ? ps.dailyCount : 0) + 1
  })

  return done('sent', `消息 #${msg.id}：${message}`)
}

async function done(action, summary) {
  console.log(`[proactive] ${action}: ${summary}`)
  if (['sent', 'decline', 'error'].includes(action)) {
    try { await moonPost('/idle/log', { action: `主动消息-${action === 'sent' ? '已发' : action === 'decline' ? '没发' : '出错'}`, summary }) } catch {}
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
