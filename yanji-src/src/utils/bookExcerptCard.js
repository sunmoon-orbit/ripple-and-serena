const CARD_WIDTH = 1080
const CARD_HEIGHT = 1440
const COVER_HEIGHT = 600

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
export function wrapExcerptText(text, maxUnits = 19, maxLines = 7) {
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

function compactSource({ author = '', title = '', chapter = '' }, limit = 34) {
  const raw = [author, title ? `《${title}》` : '', chapter].filter(Boolean).join(' · ')
  const chars = Array.from(raw)
  return chars.length > limit ? `${chars.slice(0, limit - 1).join('')}…` : raw
}

// 正文短时把剩余纸面让给批注；正文变长时逐步缩减，始终给来源区留足空间。
export function excerptCardTextLayout(quote, note = '') {
  const quoteLines = wrapExcerptText(quote, 19, 7)
  const noteFirstY = 650 + quoteLines.length * 72 + 60
  const noteLineLimit = Math.max(0, Math.floor((1200 - noteFirstY) / 42) + 1)
  const noteLines = note && noteLineLimit ? wrapExcerptText(note, 29, noteLineLimit) : []
  return { quoteLines, noteLines, noteLineLimit, noteY: noteFirstY - 12 }
}

export function buildExcerptCardSvg({
  quote,
  note = '',
  title = '未命名',
  author = '',
  chapter = '',
  color = '#6f8274',
  imageDataUrl = '',
  readingTime = '',
}) {
  const accent = safeColor(color)
  const { quoteLines, noteLines, noteY } = excerptCardTextLayout(quote, note)
  const source = compactSource({ author, title, chapter })
  const cover = imageDataUrl
    ? `<image href="${escapeXml(imageDataUrl)}" width="1080" height="600" preserveAspectRatio="xMidYMid slice"/><rect width="1080" height="600" fill="url(#shade)"/>`
    : `<rect width="1080" height="600" fill="url(#fallback)"/><rect width="1080" height="600" fill="url(#quiet)"/>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <linearGradient id="fallback" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${accent}" stop-opacity=".82"/><stop offset="1" stop-color="#20231f"/>
    </linearGradient>
    <linearGradient id="quiet" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".10"/><stop offset="1" stop-color="#000000" stop-opacity=".22"/>
    </linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity=".02"/><stop offset="1" stop-color="#000000" stop-opacity=".38"/>
    </linearGradient>
    <style>
      .quote{font-family:'Noto Serif CJK SC','Songti SC','STSong',serif;font-size:48px;font-weight:500;fill:#292824;letter-spacing:1.5px}
      .note{font-family:'Noto Sans CJK SC','PingFang SC',sans-serif;font-size:27px;fill:#77736b;letter-spacing:1px}
      .meta{font-family:'Noto Sans CJK SC','PingFang SC',sans-serif;font-size:26px;fill:#54514b;letter-spacing:.8px}
      .brand{font-family:'Noto Sans CJK SC','PingFang SC',sans-serif;font-size:23px;fill:#8f8a81;letter-spacing:3px}
      .reading{font-family:'Noto Sans CJK SC','PingFang SC',sans-serif;font-size:23px;fill:${accent};letter-spacing:.6px}
    </style>
  </defs>
  <rect width="1080" height="1440" fill="#e8e5df"/>
  ${cover}
  <text x="76" y="450" font-family="sans-serif" font-size="24" fill="#fff" opacity=".82" letter-spacing="5">书摘</text>
  <path d="M0 548Q0 500 48 500H1032Q1080 500 1080 548V1440H0Z" fill="#faf8f2"/>
  <path d="M84 612v54" stroke="${accent}" stroke-width="7" stroke-linecap="round"/>
  ${textLines(quoteLines, 120, 650, 72, 'quote')}
  ${noteLines.length ? `<path d="M120 ${noteY - 34}h840" stroke="#2d2923" opacity=".10"/>${textLines(noteLines, 120, noteY + 12, 42, 'note')}` : ''}
  <path d="M84 1252h912" stroke="#2d2923" opacity=".11"/>
  <text x="84" y="1314" class="meta">${escapeXml(source)}</text>
  <text x="84" y="1370" class="brand">言叽书架摘录</text>
  ${readingTime ? `<text x="996" y="1370" class="reading" text-anchor="end">本书近 7 天已读 ${escapeXml(readingTime)}</text>` : `<circle cx="970" cy="1359" r="11" fill="${accent}" opacity=".75"/>`}
</svg>`
}

function loadImage(source, message) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(message))
    image.src = source
  })
}

// 相册原图只在当前编辑会话里处理：缩到卡片需要的尺寸并居中裁切，
// 返回的 data URL 只进本次 SVG，不写 localStorage / IndexedDB，也不上传。
export async function prepareExcerptCover(file) {
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('请选择一张图片')
  const source = URL.createObjectURL(file)
  try {
    const image = await loadImage(source, '这张图片读取失败，请换一张试试')
    const canvas = document.createElement('canvas')
    canvas.width = CARD_WIDTH
    canvas.height = COVER_HEIGHT
    const context = canvas.getContext('2d')
    if (!context) throw new Error('图片处理失败')
    const scale = Math.max(CARD_WIDTH / image.naturalWidth, COVER_HEIGHT / image.naturalHeight)
    const width = image.naturalWidth * scale
    const height = image.naturalHeight * scale
    context.drawImage(image, (CARD_WIDTH - width) / 2, (COVER_HEIGHT - height) / 2, width, height)
    return canvas.toDataURL('image/jpeg', 0.88)
  } finally {
    URL.revokeObjectURL(source)
  }
}

export async function renderExcerptCardPng(details) {
  const svg = buildExcerptCardSvg(details)
  const source = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = await loadImage(source, '书摘卡片渲染失败')
    const canvas = document.createElement('canvas')
    canvas.width = CARD_WIDTH
    canvas.height = CARD_HEIGHT
    const context = canvas.getContext('2d')
    if (!context) throw new Error('书摘卡片生成失败')
    context.drawImage(image, 0, 0, CARD_WIDTH, CARD_HEIGHT)
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('书摘卡片生成失败')), 'image/png', 0.94)
    })
  } finally {
    URL.revokeObjectURL(source)
  }
}
