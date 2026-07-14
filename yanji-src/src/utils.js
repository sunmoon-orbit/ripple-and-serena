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

// 双语通话：涟言英文回复末尾带 [译:中文翻译] 标签 → 拆成 { main: 英文正文, zh: 中文翻译 }
// 只认结尾处的标签（中途出现的方括号不误伤）；没有标签时 zh 为 null，正文原样返回
export function splitTranslation(text) {
  if (!text) return { main: text, zh: null }
  const m = text.match(/\[译[:：]\s*([\s\S]*?)\]\s*$/)
  if (!m || !m[1].trim()) return { main: text, zh: null }
  return { main: text.slice(0, m.index).trim(), zh: m[1].trim() }
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
