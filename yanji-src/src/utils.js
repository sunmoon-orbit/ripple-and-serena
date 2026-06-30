export function uuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID()
  return Date.now().toString(16) + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
}

export function escapeHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const hhmm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return hhmm
  const isThisYear = d.getFullYear() === now.getFullYear()
  const md = `${d.getMonth() + 1}/${d.getDate()}`
  if (isThisYear) return `${md} ${hhmm}`
  return `${d.getFullYear()}/${md} ${hhmm}`
}

export function estimateTokens(text) {
  if (!text) return 0
  let tokens = 0
  for (const char of text) {
    tokens += /[一-鿿]/.test(char) ? 1.5 : 0.25
  }
  return Math.ceil(tokens)
}
