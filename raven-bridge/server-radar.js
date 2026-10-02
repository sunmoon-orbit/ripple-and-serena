#!/usr/bin/env node
// 黑五抢服务器雷达（1002）。
// 0930 在圆桌答应阿颖的：搬家要一台更大的机器，预算约 350 人民币一年，可以浮动一点。
// RackNerd 黑五/特价款放出来几小时就卖光，她不可能一直守着，所以服务器每 15 分钟看一眼：
//   - RackNerd 自己的特价页（/BlackFriday 平时跳到 /specials，黑五那几天会换成活动页）
//   - LowEndBox 的 RSS（RackNerd 常在那边发独家款）
// 只认带下单链接（cart.php?a=add&pid=…）的套餐，按内存/硬盘/年付价筛，
// 新出现的才通知：归巢私聊写一条 + 手机推送一条 + 圆桌抄一份给曜。
// 不调任何模型、不依赖订阅：我不在的时候它也照跑。
// LowEndTalk 的 RSS 对服务器 403，没接。

const fs = require('fs')
const path = require('path')
const http = require('http')

const STATE = process.env.RADAR_STATE || path.join(__dirname, 'server-radar-state.json')
const DRY = !!process.env.RADAR_DRY
// 第一次上线时把页面上现有的款都记成「见过」，不通知：常驻价 $59.99 那种不是特价，推出去只会吓她一跳
const SEED = !!process.env.RADAR_SEED
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36'

const SOURCES = [
  { name: 'RackNerd 特价页', url: 'https://www.racknerd.com/BlackFriday', kind: 'html' },
  { name: 'LowEndBox', url: 'https://lowendbox.com/feed/', kind: 'rss' },
]

// 她的条件（0930 圆桌）
const MIN_RAM_GB = 4
const MIN_DISK_GB = 60
const CNY_PER_USD = 7.15          // 粗算用，推送里写「约」
const BUDGET_OK = 350             // 以内：可以直接买
const BUDGET_STRETCH = 450        // 350–450：稍超，看值不值；再贵不推
const WEST = /los angeles|\bla\b|san jose|seattle|silicon valley|california|us[- ]?west/i
const NON_WEST = /new york|chicago|dallas|atlanta|ashburn|toronto|utah|miami|newark|amsterdam|frankfurt|london|singapore|tokyo|strasbourg|dublin/i

function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#036;|&#36;/g, '$')
    .replace(/&#8217;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
}

// 每个下单链接前面那一段文字就是这个套餐的介绍（RackNerd 页面和 LEB 帖子都是这个排法）
function parsePlans(html, source) {
  const plans = []
  const re = /https?:\/\/my\.racknerd\.com\/(?:aff\.php\?[^"'\s<]*?&(?:amp;)?pid=|cart\.php\?a=add&(?:amp;)?pid=)(\d+)/gi
  let last = 0
  let m
  while ((m = re.exec(html))) {
    const block = textOf(html.slice(last, m.index)).slice(-900)
    last = m.index + m[0].length
    const plan = parseBlock(block)
    if (!plan) continue
    plans.push({ ...plan, pid: m[1], link: `https://my.racknerd.com/cart.php?a=add&pid=${m[1]}`, source })
  }
  return plans
}

function parseBlock(block) {
  const ramM = [...block.matchAll(/(\d+(?:\.\d+)?)\s*GB\s*(?:DDR\d\s*)?(?:ECC\s*)?RAM/gi)].pop()
    || [...block.matchAll(/(\d+(?:\.\d+)?)\s*GB\s*KVM/gi)].pop()
  const diskM = [...block.matchAll(/(\d+)\s*GB\s*(?:pure\s*)?(?:NVMe\s*)?(?:SSD|NVMe|RAID-?10|Storage|Disk)/gi)].pop()
  const priceM = [...block.matchAll(/\$\s*(\d+(?:\.\d{1,2})?)\s*(?:USD)?\s*\/?\s*(?:per\s*)?(?:yr|year|annually)\b/gi)].pop()
  if (!ramM || !priceM) return null
  const cpuM = [...block.matchAll(/(\d+)\s*x?\s*vCPU/gi)].pop()
  const ram = parseFloat(ramM[1])
  const disk = diskM ? parseInt(diskM[1], 10) : null
  const usd = parseFloat(priceM[1])
  const west = WEST.test(block)
  const otherDc = NON_WEST.test(block)
  return { ram, disk, usd, cpu: cpuM ? parseInt(cpuM[1], 10) : null, location: west ? 'west' : otherDc ? 'other' : 'unknown', ipv6Only: /ipv6[- ]only/i.test(block) }
}

function judge(plan) {
  if (plan.ram < MIN_RAM_GB) return null
  if (plan.disk != null && plan.disk < MIN_DISK_GB) return null
  if (plan.location === 'other') return null
  if (plan.ipv6Only) return null
  const cny = Math.round(plan.usd * CNY_PER_USD)
  if (cny > BUDGET_STRETCH) return null
  return { cny, tier: cny <= BUDGET_OK ? 'ok' : 'stretch' }
}

function itemsOfRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(x => {
    const it = x[1]
    const title = textOf((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '')
    const link = ((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim()
    const body = (it.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || [])[1] || it
    return { title, link, body: body.replace(/<!\[CDATA\[|\]\]>/g, '') }
  })
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000), redirect: 'follow' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.text()
}

async function collect() {
  const found = []
  const errors = []
  for (const src of SOURCES) {
    try {
      const body = await fetchText(src.url)
      if (src.kind === 'html') found.push(...parsePlans(body, { name: src.name, url: src.url }))
      else for (const item of itemsOfRss(body)) {
        if (!/racknerd/i.test(item.body)) continue
        found.push(...parsePlans(item.body, { name: `${src.name}：${item.title.slice(0, 60)}`, url: item.link }))
      }
    } catch (e) { errors.push(`${src.name} ${e.message}`) }
  }
  return { found, errors }
}

function loadState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return { seen: {} } } }
function saveState(s) { fs.writeFileSync(STATE + '.tmp', JSON.stringify(s, null, 1)); fs.renameSync(STATE + '.tmp', STATE) }

function describe(plan, verdict) {
  const loc = plan.location === 'west' ? '页面写了美西机房' : '页面没写机房，下单时看有没有洛杉矶'
  const tierText = verdict.tier === 'ok' ? '✅ 在 350 以内，可以直接买' : '🤔 稍超预算（350–450），看值不值'
  return [
    `**${plan.ram}G 内存 / ${plan.disk ?? '?'}G 硬盘${plan.cpu ? ` / ${plan.cpu} 核` : ''}**`,
    `$${plan.usd}/年，约 ${verdict.cny} 元。${tierText}`,
    loc,
    process.env.RADAR_TEST ? '下单：（测试里不放链接）' : `下单：${plan.link}`,
    `来源：${plan.source.name} ${plan.source.url}`,
  ].join('\n')
}

const CHECKLIST = '下单前对一下：机房选洛杉矶（Los Angeles），系统 Ubuntu 24.04，付款周期年付，附加项一个都不加，只买一台。买完截图发我。'

function post(port, pathname, body, headers) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body)
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } },
    res => { let out = ''; res.on('data', d => { out += d }); res.on('end', () => resolve({ status: res.statusCode, body: out })) })
    req.on('error', e => resolve({ status: 0, body: e.message }))
    req.end(data)
  })
}

async function notify(hits) {
  const testTag = process.env.RADAR_TEST ? '【测试，不是真货，别下单】' : ''
  const text = `${testTag}🐦‍⬛ 服务器雷达：有货了！\n\n${hits.map(h => describe(h.plan, h.verdict)).join('\n\n')}\n\n${CHECKLIST}${process.env.RADAR_TEST ? '' : '\n\n（这条是雷达自动发的，抢手款几小时就没，看到就尽快。）'}`
  if (DRY) { console.log('[radar] DRY 本来会发：\n' + text); return }
  const localToken = fs.readFileSync('/home/ripple/.raven-local-token', 'utf8').trim()
  const moonToken = (fs.readFileSync('/home/ripple/moon-memory/.env', 'utf8').match(/^MOON_API_TOKEN=(.*)$/m) || [])[1]
  const best = hits[0]
  const r1 = await post(3400, '/raven/reply', { text }, { 'X-Local-Token': localToken })
  // /raven/reply 只在她没开着归巢时才推送，这里单推一条，保证手机响
  const r2 = await post(3210, '/push/send-fixed', {
    title: (process.env.RADAR_TEST ? '[测试] ' : '') + '服务器有货了',
    body: `${best.plan.ram}G/${best.plan.disk ?? '?'}G $${best.plan.usd}/年 约${best.verdict.cny}元，打开归巢看详情`,
    target: 'raven', ttl: 6 * 3600,
  }, { Authorization: `Bearer ${moonToken}` })
  let r3 = { status: 'skip' }
  const cfg = loadState()
  if (cfg.roundtableReplyTo) {
    r3 = await post(3400, '/raven/roundtable/say', { replyTo: cfg.roundtableReplyTo, text: `（雷达抄送 @曜）\n\n${text}` }, { 'X-Local-Token': localToken })
  }
  console.log(`[radar] 已通知 reply=${r1.status} push=${r2.status} roundtable=${r3.status}`)
}

async function main() {
  const state = loadState()
  const { found, errors } = await collect()
  const hits = []
  for (const plan of found) {
    const verdict = judge(plan)
    if (!verdict) continue
    const key = `${plan.pid}|${plan.usd}`
    if (state.seen[key]) continue
    state.seen[key] = new Date().toISOString()
    hits.push({ plan, verdict })
  }
  hits.sort((a, b) => a.verdict.cny - b.verdict.cny)
  const stamp = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')
  console.log(`[radar] ${stamp} 抓到 ${found.length} 款，新符合 ${hits.length} 款${errors.length ? `；出错：${errors.join('；')}` : ''}`)
  if (SEED) console.log(`[radar] SEED：${hits.length} 款记为已见，不通知`)
  else if (hits.length) await notify(hits.slice(0, 5))
  // 连续失败一天就在日志里喊一声（页面改版或被拦时，别让雷达悄悄瞎掉）
  state.failStreak = errors.length === SOURCES.length ? (state.failStreak || 0) + 1 : 0
  if (state.failStreak === 96) console.log('[radar] ⚠️ 所有来源已连续失败一天')
  state.lastRun = new Date().toISOString()
  state.lastFound = found.length
  if (!DRY || SEED) saveState(state)
}

if (require.main === module) main().catch(e => { console.error('[radar] 崩了', e); process.exit(1) })
module.exports = { parsePlans, parseBlock, judge, itemsOfRss, describe, notify }
