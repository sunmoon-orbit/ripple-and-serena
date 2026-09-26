#!/usr/bin/env node
// 每日检查：归巢里我的回复有没有都存进记忆库（0926 加）。
// 6/16 起我的回复三个月没存档、没人发现——存档失败以前只有一行日志。
// 现在桥接每存一条都记账（archive-stats.json），这里每天北京 00:10 看刚过完的那天：
// 发了多少条、存上多少条，对不上就给阿颖手机推一条。
const fs = require('fs')
const path = require('path')
const http = require('http')

const STATS = process.env.ARCHIVE_STATS_FILE || path.join(__dirname, 'archive-stats.json')
const envText = fs.readFileSync('/home/ripple/moon-memory/.env', 'utf8')
const TOKEN = (envText.match(/^MOON_API_TOKEN=(.*)$/m) || [])[1]

const bj = (offsetDays = 0) => new Date(Date.now() + 8 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10)
const day = bj(-1)   // 刚过完的北京日

let stats = {}
try { stats = JSON.parse(fs.readFileSync(STATS, 'utf8')) } catch (e) {
  console.log(`[archive-check] ${day} 读不到记账文件：${e.message}`)
}
const d = stats[day]
if (!d) { console.log(`[archive-check] ${day} 没有回复记录，正常`); process.exit(0) }

const lost = d.sent - d.saved
console.log(`[archive-check] ${day} 发 ${d.sent} 存 ${d.saved} 失败 ${d.failed}`)
if (lost <= 0 && d.failed === 0) process.exit(0)

const body = JSON.stringify({ title: '阿言存档提醒', body: `${day} 有 ${Math.max(lost, d.failed)} 条我的回复没存进记忆库（发 ${d.sent} / 存 ${d.saved}）。原话还在会话记录里，需要的话让我补。` })
if (process.env.ARCHIVE_CHECK_DRY) { console.log('[archive-check] DRY，本来会推送：', body); process.exit(0) }
const req = http.request({ hostname: '127.0.0.1', port: 3210, path: '/push/send-fixed', method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
  res => { res.resume(); console.log('[archive-check] 已推送提醒', res.statusCode) })
req.on('error', e => console.error('[archive-check] 推送失败', e.message))
req.end(body)
