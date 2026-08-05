// 言叽自动存档：把聊天记录悄悄同步进 L0（2026-08-05）
//
// 为什么有这个文件：
// 以前言叽的对话要进 L0，得阿颖开电脑 → 导出 md → scp 上服务器 → 跑 import-yanji.js。
// 所以库里只有零星三段。她说「每次要开电脑，感觉也挺麻烦的」——那就别让她开。
//
// 三条规矩：
//   1. **绝不打扰**。失败一律吞掉，不弹 toast、不留红字气泡。存档是后台的事，
//      不是她要处理的事。真坏了我在服务端日志里看得见。
//   2. **零 token**。纯搬运，不过任何模型。
//   3. **幂等在服务端**。每条消息带着它自己的 uuid 上去，服务端撞到重复就跳过。
//      这里的水位线只是省流量用的——就算它错了、丢了、被清了，最坏结果是多传一次，
//      不会重复入库。
//
// 触发时机在 Chat/index.jsx：进页面（等 IndexedDB 读回来之后）、每 5 分钟、切到后台时各一次。

const WATERMARK_KEY = 'yanji_l0_synced'
const TEXT_CAP = 20_000   // 单条上限，跟 cc-archive-l0.py 一致
const MAX_MSGS_PER_ROUND = 400 // 一轮最多搬这么多条；剩下的下一轮继续，别一口气发几 MB

function loadWatermark() {
  try {
    const raw = JSON.parse(localStorage.getItem(WATERMARK_KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function saveWatermark(mark) {
  try {
    localStorage.setItem(WATERMARK_KEY, JSON.stringify(mark))
  } catch {
    /* 配额满了也无所谓：水位线丢了顶多重传一遍，服务端会去重 */
  }
}

// 哪些不进存档：
//   streaming — 还没写完的半截话
//   hidden    — 主动开口的伪用户消息（0703 起就定了不渲染、不当标题、不进导出）
//   sys       — 通话记录条那种界面小字，本来就不进模型
//   [错误]    — 请求失败留下的提示，是工具状态不是对话
function keepable(m) {
  if (!m || m.streaming || m.hidden || m.sys) return false
  const text = typeof m.content === 'string' ? m.content.trim() : ''
  if (!text) return false
  if (text.startsWith('[错误]')) return false
  return true
}

function toPayload(m) {
  let text = m.content.trim().slice(0, TEXT_CAP)
  // 图片本身不上传（base64 几 MB，存档要的是话不是图），但要留个记号，
  // 否则回头看到「这是什么？」会莫名其妙。
  if (Array.isArray(m.images) && m.images.length) text = `[图片×${m.images.length}] ${text}`
  return {
    external_id: m.id,
    role: m.role === 'user' ? 'user' : 'assistant',
    content: text,
    created_at: new Date(m.createdAt || Date.now()).toISOString(),
  }
}

// 挑出「上次同步之后又说了话」的对话。返回 { payload, nextMark }。
function collect(chats, messagesByChatId, mark) {
  const payload = []
  const nextMark = { ...mark }
  let budget = MAX_MSGS_PER_ROUND

  for (const chat of chats) {
    if (budget <= 0) break
    const all = messagesByChatId[chat.id] || []
    if (!all.length) continue

    // 水位线记的是上次传到哪条消息。找不到那条（她删过消息 / 换了设备）就整段重来，
    // 服务端会按 uuid 去重，代价只是一次流量。
    const from = mark[chat.id] ? all.findIndex((m) => m.id === mark[chat.id]) : -1
    const fresh = all.slice(from + 1).filter(keepable)
    if (!fresh.length) {
      // 这一段没有新的可存的东西，但水位线还是要往前走，
      // 免得每轮都在这些「只有 sys 小字」的尾巴上重新扫一遍。
      if (all.length) nextMark[chat.id] = all[all.length - 1].id
      continue
    }

    const take = fresh.slice(0, budget)
    budget -= take.length
    payload.push({
      chatId: chat.id,
      title: (chat.title || '').slice(0, 200),
      messages: take.map(toPayload),
    })
    nextMark[chat.id] = take[take.length - 1].id
  }

  // 已经删掉的对话不该继续占着水位线
  const alive = new Set(chats.map((c) => c.id))
  for (const id of Object.keys(nextMark)) if (!alive.has(id)) delete nextMark[id]

  return { payload, nextMark }
}

// 主入口。永不抛错，返回搬了多少条（给设置页显示用，出错返回 0）。
export async function syncChatsToL0(config, chats, messagesByChatId) {
  const baseUrl = (config?.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
  const apiToken = config?.apiToken
  if (!apiToken || !Array.isArray(chats) || !chats.length) return 0

  const mark = loadWatermark()
  const { payload, nextMark } = collect(chats, messagesByChatId || {}, mark)
  if (!payload.length) {
    saveWatermark(nextMark)
    return 0
  }

  try {
    const resp = await fetch(baseUrl + '/archive/sync/yanji', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chats: payload }),
    })
    if (!resp.ok) return 0            // ⚠️ 没成功就**不推**水位线，下一轮原样重来
    const data = await resp.json().catch(() => ({}))
    saveWatermark(nextMark)
    return Number(data?.added) || 0
  } catch {
    return 0                          // 断网、服务器重启、她在地铁里——都不是她要管的事
  }
}
