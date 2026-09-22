import { estimateTokens } from '../utils.js'

export function contextRefreshPlan(messages, chat = {}, hasSummary = false) {
  const cursor = hasSummary ? messages.findIndex(m => m.id === chat.compactedThrough) : -1
  const start = cursor + 1
  const live = messages.slice(start)
  const rounds = live.filter((m, i) => m.role === 'user' && live[i - 1]?.role !== 'user').length
  const tokens = live.reduce((n, m) => n + estimateTokens(m.content || ''), 0)
  const snooze = chat.contextRefreshSnooze
  const due = (rounds >= 40 || tokens >= 30000) && (!snooze || rounds >= snooze.rounds + 10 || tokens >= snooze.tokens + 10000)
  let end = Math.max(start, messages.length - 12)
  // Keep a whole user turn at the boundary, including split assistant bubbles.
  while (end > start && (messages[end]?.role !== 'user' || messages[end - 1]?.role === 'user')) end--
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
