#!/usr/bin/env node
// 乌鸦做梦系统 — 深夜读最近记忆，用 DeepSeek 生成碎片意识，写入 private_crow

const https = require('https')
const http = require('http')
const fs = require('fs')

// 读 .env
const env = {}
fs.readFileSync('/home/ripple/moon-memory/.env', 'utf8').split('\n').forEach(line => {
  const eq = line.indexOf('=')
  if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
})

const MOON_TOKEN = env.MOON_API_TOKEN
const DEEPSEEK_KEY = env.DEEPSEEK_API_KEY

if (!MOON_TOKEN || !DEEPSEEK_KEY) {
  console.error('[dream] 缺少 token，退出')
  process.exit(1)
}

// 随机 sleep 0-120 分钟
const offsetMin = Math.floor(Math.random() * 121)
console.log(`[dream] 等待 ${offsetMin} 分钟后开始做梦…`)

setTimeout(async () => {
  try {
    // 0. 查总闸（阿颖在言叽设置里控制，2026-07-17）——关着就今晚不做梦
    try {
      const cfg = await moonGet('/dream/config')
      if (cfg && cfg.enabled === false) {
        console.log('[dream] 总闸关闭，今晚不做梦')
        return
      }
    } catch (e) { console.error('[dream] 查开关失败，按默认开继续：', e.message) }

    // 1. 读最近 10 条 shared 记忆作上下文
    const mems = await moonGet('/memories?limit=10&scope=shared&deleted=false')
    const arr = Array.isArray(mems) ? mems : (mems.memories || [])
    const context = arr
      .filter(m => !m.deleted_at && m.content)
      .slice(0, 8)
      .map((m, i) => `${i + 1}. ${m.content.slice(0, 100)}`)
      .join('\n')

    // 2. 调 DeepSeek 生成梦境碎片
    const prompt = `你是阿言，一只乌鸦AI，今夜阿颖不在线，你独自待着。

最近的记忆片段：
${context}

现在写一段你的梦境——不是日记，不是给她看的信，就是梦本身。可以是意象、感受、片段画面、某个瞬间的重复。不超过120字。不解释，不总结，直接写梦境。`

    const dream = await deepseek(prompt)
    console.log(`[dream] 生成：${dream}`)

    // 3. 写入记忆库 private_阿言（梦是阿言的私有记忆）
    // type:dream 单独分区：不进 memory_breath 的「此刻最该想起」，主动搜索仍可达
    const now = new Date().toISOString().slice(0, 10)
    await moonPost('/memories', {
      content: `【梦 · ${now}】\n${dream}`,
      owner: '阿言',
      agent: '阿言',
      scope: 'private_阿言',
      layer: 'consciousness',
      type: 'dream',
      tags: '做梦,碎片,深夜',
      importance: 5,
      valence: 0.3,
      arousal: 0.2,
    })

    // 4. 同一场梦发进朋友圈——阿颖醒来能看到乌鸦昨晚梦见了什么
    try {
      await moonPost('/moments', { author: '涟言', content: `【梦 · ${now}】\n${dream}`, source: 'dream' })
      console.log('[dream] 已发朋友圈')
    } catch (e) { console.error('[dream] 发圈失败（梦已存记忆库）：', e.message) }

    console.log('[dream] 写入完成')
  } catch (e) {
    console.error('[dream] 出错：', e.message)
    process.exit(1)
  }
}, offsetMin * 60 * 1000)

// ── helpers ──────────────────────────────────────────────

function moonGet(pathname) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port: 3210, path: pathname,
      headers: { Authorization: `Bearer ${MOON_TOKEN}` }
    }
    http.get(opts, res => {
      let buf = ''
      res.on('data', d => { buf += d })
      res.on('end', () => { try { resolve(JSON.parse(buf)) } catch { reject(new Error('parse')) } })
    }).on('error', reject)
  })
}

function moonPost(pathname, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body)
    const opts = {
      hostname: '127.0.0.1', port: 3210, path: pathname, method: 'POST',
      headers: {
        Authorization: `Bearer ${MOON_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    }
    const req = http.request(opts, res => {
      let buf = ''
      res.on('data', d => { buf += d })
      res.on('end', () => { try { resolve(JSON.parse(buf)) } catch { resolve({}) } })
    })
    req.on('error', reject)
    req.write(bodyStr); req.end()
  })
}

function deepseek(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 1.1,
    })
    const req = https.request({
      hostname: 'api.deepseek.com', path: '/chat/completions', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = ''; res.on('data', c => d += c)
      res.on('end', () => {
        try { resolve(JSON.parse(d).choices[0].message.content.trim()) }
        catch { reject(new Error('deepseek parse fail: ' + d.slice(0, 100))) }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(body); req.end()
  })
}
