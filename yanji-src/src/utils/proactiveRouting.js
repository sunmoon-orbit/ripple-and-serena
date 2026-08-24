export function normalizeConversationExternalId(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

export function findConversationChat(chats, externalId) {
  const id = normalizeConversationExternalId(externalId)
  if (!id || !Array.isArray(chats)) return null
  return chats.find((chat) => chat?.id === id) || null
}

export function hasProactiveMessage(messages, proactiveId) {
  if (proactiveId === null || proactiveId === undefined) return false
  const id = String(proactiveId)
  return Array.isArray(messages) && messages.some((message) =>
    message?.proactiveId !== null && message?.proactiveId !== undefined &&
    String(message.proactiveId) === id
  )
}

export function pendingCallMatches(pending, invite) {
  if (!pending || !invite) return false
  if (!pending.callId) return true
  return String(pending.callId) === String(invite.serverId)
}


// 主动消息由 SQLite datetime('now') 返回 UTC 时间；统一转成毫秒时间戳，
// 让前端晚些打开时仍显示消息真正发出的时间，而不是本次同步时间。
export function parseProactiveCreatedAt(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const raw = value.trim()
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z'
  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null
}
