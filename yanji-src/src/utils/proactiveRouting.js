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
