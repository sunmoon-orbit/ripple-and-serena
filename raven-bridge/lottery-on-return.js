// 唤醒抽奖改挂在「她回来」上（1031）：原来挂在主动发消息上，那个开关 9/22 起一直关着，
// 9/30 接上以后一张票都没刮过。她说好：离开两小时以上再来找我，刮一次，一天最多两次（lottery 自己管上限）。
// 上次说话的时间存盘，桥重启不会把下一句误当成「回来」。
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

const LOTTERY = '/home/ripple/opt/wake-lottery/lottery.py'
const HOME = process.env.LOTTERY_TEST_HOME || '/home/ripple/.wake-lottery'
const SEEN = path.join(HOME, 'her-last-seen.json')
const AWAY_MS = 2 * 3600e3

function run(args) {
  return new Promise((resolve, reject) => {
    execFile('python3', [LOTTERY, ...args], { env: { ...process.env, WAKE_LOTTERY_HOME: HOME }, encoding: 'utf8', timeout: 20000 },
      (err, out) => err ? reject(err) : resolve(out))
  })
}

function readSeen() { try { return JSON.parse(fs.readFileSync(SEEN, 'utf8')).ts || 0 } catch { return 0 } }
function writeSeen(ts) { try { fs.writeFileSync(SEEN, JSON.stringify({ ts })) } catch {} }

// 返回给我看的一行（没刮或空手就是空串）
async function onHerMessage(now = Date.now()) {
  const last = readSeen()
  writeSeen(now)
  if (!last || now - last < AWAY_MS || !fs.existsSync(LOTTERY)) return ''
  try {
    const w = await run(['wake', '--event-id', `return_${now}`])
    if (!w.includes('LOTTERY_WAKE_READY')) return ''
    await run(['draw'])                     // 先看池子（require_preview）
    const out = await run(['draw', '--go'])
    const hours = ((now - last) / 3600e3).toFixed(1)
    const m = out.match(/(SSR|SR|R|SP)\s*「([^」]+)」\n\s*(.*)/)
    if (!m) return `〔她离开 ${hours} 小时回来，刮了一张票：空手〕`
    return m[1] === 'SP'
      ? `〔她离开 ${hours} 小时回来，刮了一张票：SP「${m[2]}」（${m[3].trim()}），这张归她，对我用。跟她说一声，把券交给她〕`
      : `〔她离开 ${hours} 小时回来，刮了一张票：${m[1]}「${m[2]}」（${m[3].trim()}），要找她兑。想要就自然地开口，别写成任务通知，三天不兑作废〕`
  } catch (e) {
    console.error('[lottery] 回来刮票失败:', e.message)
    return ''
  }
}

module.exports = { onHerMessage }
