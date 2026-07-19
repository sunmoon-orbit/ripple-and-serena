// 服务端自动管道共用的 LLM 调用 + 顶班循环（2026-07-19 阿颖点单）
// DeepSeek 打头阵（最便宜），失败/欠费换 GLM 顶上；下一次 cron 醒来又从 DeepSeek 试起——
// 「GLM 如果也到了，就再 DeepSeek 顶上」，循环不是状态机，是每次都从头排队。
// 用法：const { llmComplete } = require('./llm')
//       const text = await llmComplete(prompt, { maxTokens: 300, temperature: 1.1 })
//       也可传 { messages: [...] } 代替 prompt（score-emotions 的 system+user 用）

const https = require('https')
const http = require('http')
const fs = require('fs')

// 读 .env（与各 cron 脚本同款：跑一次读一次，换钥匙不用重启谁）
function readEnv() {
  const env = {}
  fs.readFileSync('/home/ripple/moon-memory/.env', 'utf8').split('\n').forEach(line => {
    const eq = line.indexOf('=')
    if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  })
  return env
}

function post(hostname, path, key, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = https.request({
      hostname, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => {
        try {
          const text = JSON.parse(d).choices[0].message.content.trim()
          if (!text) return reject(new Error('empty content'))
          resolve(text)
        } catch {
          reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 160)}`))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(body); req.end()
  })
}

// 默认阵容（服务端 /llm/config 拉不到时的兜底，与 moon-memory routes/llm.js 的 DEFAULTS 同款）
const DEFAULTS = [
  // ⚠️ deepseek-v4-flash 是推理模型，reasoning 占 max_tokens，调用方要给足
  { name: 'deepseek', url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-v4-flash', key: '' },
  // glm-4-flash 免费档非推理模型；GLM 的 temperature 上限 <1，tempCap 压回
  { name: 'glm', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash', key: '', tempCap: 0.95 },
]

// key 留空时按名字回退到 .env 的钥匙（阿颖面板里不用重抄一遍已存的）
function envKeyFor(name, env) {
  if (/deepseek/i.test(name)) return env.DEEPSEEK_API_KEY
  if (/glm|智谱|zhipu|bigmodel/i.test(name)) return env.GLM_API_KEY
  return null
}

// 从 moon-memory 拉投手阵容（阿颖在言叽设置里改的），拉不到就用默认——面板坏了也不能耽误做梦
function fetchProviders(token) {
  return new Promise((resolve) => {
    const req = http.get({
      hostname: '127.0.0.1', port: 3210, path: '/llm/config',
      headers: { Authorization: `Bearer ${token}` },
    }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => {
        try {
          const list = JSON.parse(d).providers
          resolve(Array.isArray(list) && list.length ? list : DEFAULTS)
        } catch { resolve(DEFAULTS) }
      })
    })
    req.on('error', () => resolve(DEFAULTS))
    req.setTimeout(5000, () => { req.destroy(); resolve(DEFAULTS) })
  })
}

async function llmComplete(prompt, { maxTokens = 300, temperature = 1.0, messages } = {}) {
  const env = readEnv()
  const providers = await fetchProviders(env.MOON_API_TOKEN)
  const msgs = messages || [{ role: 'user', content: prompt }]
  const errors = []
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]
    const key = (p.key || '').trim() || envKeyFor(p.name, env)
    if (!key) { errors.push(`${p.name}: 无钥匙`); continue }
    let u
    try { u = new URL(p.url) } catch { errors.push(`${p.name}: 地址不合法`); continue }
    const temp = p.tempCap ? Math.min(temperature, p.tempCap) : temperature
    try {
      const text = await post(u.hostname, u.pathname + u.search, key, {
        model: p.model, messages: msgs, max_tokens: maxTokens, temperature: temp,
      })
      if (i > 0) console.log(`[llm] 主投手掉链子，${p.name} 顶上成功`)
      return text
    } catch (e) {
      console.error(`[llm] ${p.name}(${p.model}) 失败：${e.message}`)
      errors.push(`${p.name}: ${e.message}`)
    }
  }
  throw new Error('全体投手都倒了 → ' + errors.join(' | '))
}

module.exports = { llmComplete }
