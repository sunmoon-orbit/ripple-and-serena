import { parseMusicShareContext } from '../../utils/musicShare.js'

export function threadsFromRead(thread) {
  const out = []
  for (const turn of thread?.turns || []) {
    for (const item of turn.items || []) {
      if (item.type === 'userMessage') {
        const text = (item.content || []).filter(x => x.type === 'text').map(x => x.text).join('')
        const music = parseMusicShareContext(text)
        const previews = (item.content || []).filter(x => x.type === 'image' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(x.url || '')).map(x => x.url)
        const files = (item.content || []).filter(x => x.type === 'file' && /^data:text\/plain;base64,/.test(x.url || ''))
        out.push({ id: item.id, role: 'user', text: music ? `点给你：${music.name} — ${music.artist}` : text, previews, files, music: music || undefined })
      }
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
