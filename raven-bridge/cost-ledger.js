#!/usr/bin/env node
// 账本（1030 她问「有地方可以看历史账单吗」，说放进小票里，有月记录和年记录）。
// 把我所有窗口的会话记录一行行流式过一遍（这台机器内存小，别整个读），按北京日期把每次调模型的花销加起来，
// 记进 ~/raven-private/cost-ledger.json。北京每天 00:05 跑一次（crontab）；今天的不入账，明天零点再记。
// 会话记录会被 CC 按天数清理，所以已经入账的日子（昨天以前）不再覆盖，免得记录被清掉后把旧账改小。
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { costOf } = require('./turn-stats')

const LEDGER = '/home/ripple/raven-private/cost-ledger.json'
const ROOTS = ['/home/ripple/.claude/projects/-home-ripple', '/home/ripple/.claude/projects/-home-ripple-ripple-and-serena']
const bjDay = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10)

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) files(p, out)
    else if (e.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

async function main() {
  const today = bjDay(Date.now())
  const days = {}, seen = new Set()
  for (const f of ROOTS.filter(fs.existsSync).flatMap(r => files(r))) {
    const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity })
    for await (const line of rl) {
      if (!line.includes('"usage"') || !line.includes('"assistant"')) continue
      let d; try { d = JSON.parse(line) } catch { continue }
      const m = d.message
      if (d.type !== 'assistant' || !m?.usage || m.model === '<synthetic>') continue
      const key = m.id || d.uuid
      if (seen.has(key)) continue
      seen.add(key)
      const day = bjDay(Date.parse(d.timestamp))
      if (!(day < today)) continue
      const u = m.usage, x = days[day] ||= { calls: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0 }
      x.calls++
      x.cacheRead += u.cache_read_input_tokens || 0
      x.cacheWrite += u.cache_creation_input_tokens || 0
      x.output += u.output_tokens || 0
      x.cost += costOf(u)
    }
  }
  let ledger = {}
  try { ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8')) } catch {}
  const yesterday = bjDay(Date.now() - 86400e3)
  let added = 0
  for (const [day, x] of Object.entries(days)) {
    if (ledger[day] && day < yesterday) continue
    x.cost = Math.round(x.cost * 100) / 100
    ledger[day] = x; added++
  }
  const sorted = Object.fromEntries(Object.entries(ledger).sort(([a], [b]) => a.localeCompare(b)))
  fs.writeFileSync(LEDGER + '.tmp', JSON.stringify(sorted))
  fs.renameSync(LEDGER + '.tmp', LEDGER)
  console.log(`${new Date().toISOString()} cost-ledger: ${Object.keys(sorted).length} days, wrote ${added}`)
}

main().catch(e => { console.error(e); process.exit(1) })
