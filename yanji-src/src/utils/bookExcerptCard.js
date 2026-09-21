const CARD_WIDTH = 1080
const CARD_HEIGHT = 1440

function escapeXml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#6f8274'
}

// 中英文混排的轻量换行：汉字算 1，拉丁字母约算 0.55，避免卡片右侧溢出。
export function wrapExcerptText(text, maxUnits = 17, maxLines = 11) {
  const chars = Array.from(String(text || '').replace(/\s+/g, ' ').trim())
  const lines = []
  let line = ''
  let units = 0
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i]
    const weight = /[\x00-\xff]/.test(char) ? 0.55 : 1
    if (line && units + weight > maxUnits) {
      lines.push(line)
      line = ''
      units = 0
      if (lines.length === maxLines) break
    }
    line += char
    units += weight
  }
  if (line && lines.length < maxLines) lines.push(line)
  const shown = lines.join('')
  if (shown.length < chars.join('').length && lines.length) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/[，。！？；、,.!?;\s]+$/u, '').slice(0, -1) + '…'
  }
  return lines
}

function textLines(lines, x, y, lineHeight, className) {
  return lines.map((line, index) => (
    `<text x="${x}" y="${y + index * lineHeight}" class="${className}">${escapeXml(line)}</text>`
  )).join('')
}

export function buildExcerptCardSvg({ quote, note = '', title = '未命名', author = '', chapter = '', color = '#6f8274' }) {
  const accent = safeColor(color)
  const quoteLines = wrapExcerptText(quote, 17, note ? 9 : 11)
  const noteLines = note ? wrapExcerptText(note, 28, 3) : []
  const sourceRaw = [author, title ? `《${title}》` : '', chapter].filter(Boolean).join(' · ')
  const sourceChars = Array.from(sourceRaw)
  const source = sourceChars.length > 30 ? `${sourceChars.slice(0, 29).join('')}…` : sourceRaw
  const noteY = 355 + quoteLines.length * 76 + 72
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fffdf7"/><stop offset="1" stop-color="#f4efe5"/>
    </linearGradient>
    <linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${accent}" stop-opacity=".28"/><stop offset="1" stop-color="${accent}" stop-opacity=".04"/>
    </linearGradient>
    <pattern id="grain" width="38" height="38" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="5" r="1" fill="#453e34" opacity=".045"/><circle cx="27" cy="22" r=".8" fill="#453e34" opacity=".04"/>
    </pattern>
    <mask id="moon-cut"><rect width="100%" height="100%" fill="white"/><circle cx="930" cy="165" r="84" fill="black"/></mask>
    <style>
      .quote{font-family:'Noto Serif CJK SC','Songti SC','STSong',serif;font-size:50px;font-weight:600;fill:#27241f;letter-spacing:2px}
      .note{font-family:'Noto Sans CJK SC','PingFang SC',sans-serif;font-size:29px;fill:#5d584f;letter-spacing:1px}
      .meta{font-family:'Noto Sans CJK SC','PingFang SC',sans-serif;font-size:27px;fill:#645f56;letter-spacing:1px}
      .brand{font-family:'Noto Serif CJK SC','Songti SC',serif;font-size:25px;fill:${accent};letter-spacing:7px}
    </style>
  </defs>
  <rect width="1080" height="1440" fill="url(#paper)"/>
  <rect width="1080" height="1440" fill="url(#grain)"/>
  <path d="M0 0H1080V325C835 233 623 282 421 192C262 121 145 48 0 91Z" fill="url(#wash)"/>
  <circle cx="873" cy="151" r="91" fill="${accent}" opacity=".3" mask="url(#moon-cut)"/>
  <g fill="none" stroke="${accent}" stroke-linecap="round" opacity=".46">
    <path d="M829 116c35 23 65 57 82 96" stroke-width="3"/>
    <path d="M161 1185c44-97 103-171 174-222 42-31 82-41 105-25 26 18 13 59-20 91-54 53-139 89-259 156Z" stroke-width="4"/>
    <path d="M180 1170c80-66 146-119 236-214M237 1112l-8-62M294 1068l3-67M346 1020l17-56" stroke-width="3"/>
    <path d="M749 1267c82-31 147-35 214-16M789 1300c58-17 111-17 164-3" stroke-width="2"/>
  </g>
  <g fill="${accent}" opacity=".48"><circle cx="774" cy="116" r="6"/><circle cx="805" cy="83" r="3"/><circle cx="955" cy="276" r="4"/></g>
  <path d="M118 248h112" stroke="${accent}" stroke-width="8" stroke-linecap="round"/>
  <text x="118" y="198" class="brand">阅读书摘</text>
  <text x="112" y="338" font-family="serif" font-size="90" fill="${accent}" opacity=".55">“</text>
  ${textLines(quoteLines, 132, 405, 76, 'quote')}
  ${noteLines.length ? `<path d="M132 ${noteY - 48}h816" stroke="${accent}" opacity=".2"/><text x="132" y="${noteY}" class="note" fill="${accent}">札记</text>${textLines(noteLines, 132, noteY + 55, 46, 'note')}` : ''}
  <g transform="translate(0 1264)">
    <path d="M118 0h844" stroke="#2d2923" opacity=".12"/>
    <text x="118" y="73" class="meta">${escapeXml(source)}</text>
    <text x="118" y="119" class="meta" opacity=".58">由言叽书架摘录</text>
    <path d="M927 69l16 16 31-39" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`
}

export async function renderExcerptCardPng(details) {
  const svg = buildExcerptCardSvg(details)
  const source = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    image.decoding = 'async'
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = () => reject(new Error('书摘卡片渲染失败'))
      image.src = source
    })
    const canvas = document.createElement('canvas')
    canvas.width = CARD_WIDTH
    canvas.height = CARD_HEIGHT
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0, CARD_WIDTH, CARD_HEIGHT)
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('书摘卡片生成失败')), 'image/png', 0.94)
    })
  } finally {
    URL.revokeObjectURL(source)
  }
}
