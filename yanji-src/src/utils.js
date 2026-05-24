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
  const diff = now - d
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  const days = Math.floor(diff / 86400000)
  if (days < 7) return days + '天前'
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export function estimateTokens(text) {
  if (!text) return 0
  let tokens = 0
  for (const char of text) {
    tokens += /[一-鿿]/.test(char) ? 1.5 : 0.25
  }
  return Math.ceil(tokens)
}
