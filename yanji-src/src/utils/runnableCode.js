export function looksRunnableHtml(className = '', source = '') {
  if (/language-(html|xml|svg)/i.test(className)) return true
  return /^\s*<(!doctype|html|svg|body|div|style|canvas|section|main)[\s>]/i.test(source)
}

export function isRunnableHtmlMessage(text = '') {
  const source = String(text).trim()
  return looksRunnableHtml('', source) || /^```(?:html|xml|svg)(?:\s|$)/i.test(source)
}
