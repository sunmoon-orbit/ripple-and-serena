// 服务端自动管道共用的 LLM 调用 + 顶班循环（2026-07-19 阿颖点单）
// DeepSeek 打头阵（最便宜），失败/欠费换 GLM 顶上；下一次 cron 醒来又从 DeepSeek 试起——
// 「GLM 如果也到了，就再 DeepSeek 顶上」，循环不是状态机，是每次都从头排队。
// 用法：const { llmComplete } = require('./llm')
//       const text = await llmComplete(prompt, { maxTokens: 300, temperature: 1.1 })
//       也可传 { messages: [...] } 代替 prompt（score-emotions 的 system+user 用）

const https = require('https')
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

const PROVIDERS = [
  {
    name: 'deepseek',
    keyName: 'DEEPSEEK_API_KEY',
    call: (key, messages, maxTokens, temperature) =>
      // ⚠️ deepseek-v4-flash 是推理模型，reasoning 占 max_tokens，调用方要给足
      post('api.deepseek.com', '/chat/completions', key, {
        model: 'deepseek-v4-flash', messages, max_tokens: maxTokens, temperature,
      }),
  },
  {
    name: 'glm',
    keyName: 'GLM_API_KEY',
    call: (key, messages, maxTokens, temperature) =>
      // glm-4-flash 免费档非推理模型；GLM 的 temperature 上限 <1，压回 0.95
      post('open.bigmodel.cn', '/api/paas/v4/chat/completions', key, {
        model: 'glm-4-flash', messages, max_tokens: maxTokens,
        temperature: Math.min(temperature, 0.95),
      }),
  },
]

async function llmComplete(prompt, { maxTokens = 300, temperature = 1.0, messages } = {}) {
  const env = readEnv()
  const msgs = messages || [{ role: 'user', content: prompt }]
  const errors = []
  for (const p of PROVIDERS) {
    const key = env[p.keyName]
    if (!key) { errors.push(`${p.name}: 无钥匙`); continue }
    try {
      const text = await p.call(key, msgs, maxTokens, temperature)
      if (p.name !== 'deepseek') console.log(`[llm] deepseek 掉链子，${p.name} 顶上成功`)
      return text
    } catch (e) {
      console.error(`[llm] ${p.name} 失败：${e.message}`)
      errors.push(`${p.name}: ${e.message}`)
    }
  }
  throw new Error('全体投手都倒了 → ' + errors.join(' | '))
}

module.exports = { llmComplete }
