export function hideCoreadConversation(conversations, conversationId) {
  if (!Array.isArray(conversations)) return []
  return conversations.filter((conversation) => Number(conversation.id) !== Number(conversationId))
}

export function restoreCoreadConversation(conversations, conversation, index = 0) {
  const list = hideCoreadConversation(conversations, conversation?.id)
  if (!conversation?.id) return list
  const insertionIndex = Math.max(0, Math.min(Number(index) || 0, list.length))
  return [...list.slice(0, insertionIndex), conversation, ...list.slice(insertionIndex)]
}
