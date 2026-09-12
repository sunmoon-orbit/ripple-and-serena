export function looksRunnableHtml(className = '', source = '') {
  if (/language-(html|xml|svg)/i.test(className)) return true
  return /^\s*(?:<!doctype\s+html\b|<!--|<(?:html|head|title|meta|link|svg|body|div|style|script|canvas|section|main|h[1-6]|p|button|span|article|header|footer|ul|ol|table|form|input|img|a)(?=[\s/>]))/i.test(source)
}

export function isRunnableHtmlMessage(text = '') {
  return Boolean(extractRunnableHtmlMessage(text))
}

export function extractRunnableHtmlMessage(text = '') {
  const source = String(text).trim()
  if (looksRunnableHtml('', source)) return source
  const fenced = source.match(/^(`{3,}|~{3,})([\w-]*)[^\S\r\n]*\r?\n([\s\S]*?)\r?\n?\1\s*$/)
  if (!fenced) return ''
  const language = fenced[2].toLowerCase()
  const body = fenced[3].trim()
  if (['html', 'htm', 'xml', 'svg'].includes(language)) return body
  return !language && looksRunnableHtml('', body) ? body : ''
}
