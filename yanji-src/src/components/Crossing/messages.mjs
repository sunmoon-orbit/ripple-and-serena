export function threadsFromRead(thread) {
  const out = []
  for (const turn of thread?.turns || []) {
    for (const item of turn.items || []) {
      if (item.type === 'userMessage') out.push({ id: item.id, role: 'user', text: (item.content || []).filter(x => x.type === 'text').map(x => x.text).join('') })
      if (item.type === 'agentMessage') out.push({ id: item.id, turnId: turn.id, role: 'assistant', text: item.text || '', completed: turn.status === 'completed' })
    }
  }
  return out
}
export function completeTurn(messages, turn) {
  return messages.map(message => message.turnId === turn?.id ? { ...message, streaming: false, completed: turn.status === 'completed' } : message)
}
export function canReadMessage(message) {
  return message.role === 'assistant' && message.completed === true && !message.streaming && !!message.text?.trim()
}
