import { estimateTokens } from '../utils.js'

export function contextRefreshPlan(messages, chat = {}, hasSummary = false, options = {}) {
  const cursor = hasSummary ? messages.findIndex(m => m.id === chat.compactedThrough) : -1
  const start = cursor + 1
  const live = messages.slice(start)
  const rounds = live.filter((m, i) => m.role === 'user' && live[i - 1]?.role !== 'user').length
  const tokens = live.reduce((n, m) => n + estimateTokens(m.content || ''), 0)
  const maxRounds = Math.max(10, Number(options.maxRounds) || 40)
  const maxTokens = Math.max(1000, Number(options.maxTokens) || 30000)
  const keepRounds = Math.max(4, Number(options.keepRounds) || 12)
  const snooze = options.ignoreSnooze ? null : chat.contextRefreshSnooze
  const due = (rounds >= maxRounds || tokens >= maxTokens) && (!snooze || rounds >= snooze.rounds + 10 || tokens >= snooze.tokens + 10000)

  // 翻页时把分界线钉在完整用户轮次上，并保留最近 keepRounds 轮。
  // 两次翻页之间分界线不动，后续消息只追加在尾部，保护提示缓存。
  const userStarts = []
  for (let i = 0; i < live.length; i++) {
    if (live[i]?.role === 'user' && live[i - 1]?.role !== 'user') userStarts.push(i)
  }
  const keepFrom = userStarts.length > keepRounds ? userStarts[userStarts.length - keepRounds] : 0
  const end = start + keepFrom
  return { start, end, rounds, tokens, due: due && end > start }
}

// Split oversized messages too: no source text is silently dropped at 800/12000 characters.
export function compactionBatches(messages, limit = 10000) {
  const batches = []
  let batch = [], size = 0
  for (const message of messages) {
    const text = String(message.content || '')
    for (let offset = 0; offset < text.length; offset += limit) {
      const content = text.slice(offset, offset + limit)
      if (size + content.length > limit && batch.length) { batches.push(batch); batch = []; size = 0 }
      batch.push({ role: message.role, content })
      size += content.length
    }
  }
  if (batch.length) batches.push(batch)
  return batches
}
