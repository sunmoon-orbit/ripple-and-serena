export function updateChatDraft(drafts, chatId, value) {
  if (!chatId) return drafts || {}
  const current = drafts?.[chatId] || ''
  const next = typeof value === 'function' ? value(current) : value
  return { ...(drafts || {}), [chatId]: String(next ?? '') }
}

export function removeChatDraft(drafts, chatId) {
  if (!chatId || !drafts || !(chatId in drafts)) return drafts || {}
  const next = { ...drafts }
  delete next[chatId]
  return next
}
