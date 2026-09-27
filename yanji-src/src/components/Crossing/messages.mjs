import { parseMusicShareContext } from '../../utils/musicShare.js'

export const CROSSING_CALL_NOTE = '【语音通话】现在正在和阿颖通话。请直接回答她刚说的话，保持自然、口语化、简短（通常 2-4 句）；不要使用标题、清单、代码块或链接。'
export const CROSSING_CALL_BILINGUAL_NOTE = '【双语语音通话】阿颖说中文，请用自然、简短的英文回答（通常 2-4 句），并在末尾另起一行写 [译:完整中文翻译]。方括号内只放中文翻译。'

const HIDDEN_CONTEXT_OPEN = '<crossing-hidden-context>'
const HIDDEN_CONTEXT_CLOSE = '</crossing-hidden-context>'
const LEGACY_HIDDEN_NOTES = [CROSSING_CALL_BILINGUAL_NOTE, CROSSING_CALL_NOTE]

export function withHiddenContext(visibleText, hiddenText) {
  if (!hiddenText) return visibleText
  return `${visibleText}\n\n${HIDDEN_CONTEXT_OPEN}\n${hiddenText}\n${HIDDEN_CONTEXT_CLOSE}`
}

export function visibleUserText(value) {
  const text = String(value || '')
  const markedAt = text.indexOf(`\n\n${HIDDEN_CONTEXT_OPEN}`)
  if (markedAt >= 0) return text.slice(0, markedAt).trimEnd()
  for (const note of LEGACY_HIDDEN_NOTES) {
    const suffix = `\n\n${note}`
    if (text.endsWith(suffix)) return text.slice(0, -suffix.length).trimEnd()
  }
  return text
}

export function threadsFromRead(thread) {
  const out = []
  for (const turn of thread?.turns || []) {
    for (const item of turn.items || []) {
      if (item.type === 'userMessage') {
        const text = visibleUserText((item.content || []).filter(x => x.type === 'text').map(x => x.text).join(''))
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
