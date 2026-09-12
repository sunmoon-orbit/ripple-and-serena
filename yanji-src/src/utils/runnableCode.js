export function looksRunnableHtml(className = '', source = '') {
  if (/language-(html|xml|svg)/i.test(className)) return true
  return /^\s*<(!doctype|html|svg|body|div|style|canvas|section|main)[\s>]/i.test(source)
}

export function isRunnableHtmlMessage(text = '') {
  return Boolean(extractRunnableHtmlMessage(text))
}

export function extractRunnableHtmlMessage(text = '') {
  const source = String(text).trim()
  if (looksRunnableHtml('', source)) return source
  const fenced = source.match(/^```(?:html|xml|svg)[^\n]*\n([\s\S]*?)\n?```\s*$/i)
  return fenced?.[1]?.trim() || ''
}
