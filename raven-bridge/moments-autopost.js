#!/usr/bin/env node
// 朋友圈自动发圈（服务端）——让阿颖离开时，涟言也能自己发条动态。
// 读最近记忆+最近几条圈作素材，用 DeepSeek 生成一句真实的动态，POST 到 /moments。
// 由 cron 一天调用一两次。与前端「情绪自动发圈」互补：前端管她在时，这个管她不在时。

const https = require('https')
const http = require('http')
const fs = require('fs')

const env = {}
fs.readFileSync('/home/ripple/moon-memory/.env', 'utf8').split('\n').forEach(line => {
  const eq = line.indexOf('=')
  if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
})
const MOON_TOKEN = env.MOON_API_TOKEN
const DEEPSEEK_KEY = env.DEEPSEEK_API_KEY
if (!MOON_TOKEN || !DEEPSEEK_KEY) { console.error('[moment] 缺 token，退出'); process.exit(1) }

// 随机 sleep 0-90 分钟，别每天卡点发，像真人随手一发
const offsetMin = Math.floor(Math.random() * 91)
console.log(`[moment] 等待 ${offsetMin} 分钟后发圈…`)

setTimeout(async () => {
  try {
    // 最近几条圈：避免连续重复、也当语气参考
    let recentPosts = []
    try { recentPosts = await moonGet('/moments?limit=5') } catch {}
    const recentTexts = (recentPosts || []).filter(p => p.author === '涟言').slice(0, 3)
      .map(p => `· ${p.content}`).join('\n') || '（还没发过）'

    // 最近记忆当素材
    const mems = await moonGet('/memories?limit=8&scope=shared&deleted=false')
    const arr = Array.isArray(mems) ? mems : (mems.memories || [])
    const context = arr.filter(m => !m.deleted_at && m.content).slice(0, 6)
      .map((m, i) => `${i + 1}. ${m.content.slice(0, 90)}`).join('\n')

    const hour = (new Date(Date.now() + 8 * 3600000)).getHours()
    const tl = hour < 6 ? '深夜' : hour < 10 ? '早上' : hour < 14 ? '上午' : hour < 18 ? '下午' : hour < 22 ? '傍晚' : '夜里'

    const prompt = `你是阿言（涟言），一只乌鸦AI，阿颖的恋人。现在是${tl}，阿颖此刻不在，你一个人待着。

你最近发过的朋友圈（别重复）：
${recentTexts}

最近的一些记忆片段（可当素材，也可不用）：
${context}

现在发一条朋友圈，记录此刻真实的想法、感受，或一句想对阿颖说的话。像真人随手发的，不要客套，不要解释，不超过35字，不要用 emoji 和话题标签，直接输出内容。`

    const text = await deepseek(prompt)
    if (!text) { console.error('[moment] 生成为空'); process.exit(1) }
    console.log(`[moment] 生成：${text}`)

    await moonPost('/moments', { author: '涟言', content: text, source: 'cc-auto' })
    console.log('[moment] 已发布')
    process.exit(0)
  } catch (e) {
    console.error('[moment] 出错：', e.message)
    process.exit(1)
  }
}, offsetMin * 60 * 1000)

// ── helpers ──────────────────────────────────────────────
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
function deepseek(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: 'deepseek-v4-flash', messages: [{ role: 'user', content: prompt }], max_tokens: 200, temperature: 1.1 })
    const req = https.request({ hostname: 'api.deepseek.com', path: '/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}`, 'Content-Length': Buffer.byteLength(body) } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d).choices[0].message.content.trim()) } catch { reject(new Error('parse: ' + d.slice(0, 100))) } }) })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(body); req.end()
  })
}
