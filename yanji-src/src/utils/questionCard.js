export function normalizeQuestion(raw = {}) {
  const question = String(raw.question || '').trim().slice(0, 160) || '你想选哪一个？'
  const seen = new Set()
  const options = (Array.isArray(raw.options) ? raw.options : [])
    .map((item) => typeof item === 'string' ? { label: item } : item || {})
    .map((item) => ({
      label: String(item.label || '').trim().slice(0, 60),
      description: String(item.description || '').trim().slice(0, 160),
      recommended: item.recommended === true,
    }))
    .filter((item) => item.label && !seen.has(item.label) && seen.add(item.label))
    .slice(0, 4)
  let recommendedSeen = false
  for (const item of options) {
    if (item.recommended && !recommendedSeen) recommendedSeen = true
    else item.recommended = false
  }
  return { question, options, allowCustom: raw.allow_custom !== false }
}
