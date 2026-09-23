// 图片经过鉴权读取，令牌不放进图片 URL；列表只返回描述与缩略图地址。
import { stripEmotionTag } from '../utils/emotion.js'
import { stripInlineFx, stripMoodTag, stripUnknownAssistantTags } from '../utils/moodFx.js'

export const ALBUM_PATH = '/moments/album'

export async function albumRequest(config, path = '', options = {}) {
  if (!config?.enabled || !config.apiToken) throw new Error('请先在 Hollow 连接记忆库')
  const response = await fetch(`${(config.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')}${ALBUM_PATH}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${config.apiToken}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  if (!response.ok) {
    if (response.status === 404) throw new Error('相册服务尚未上线，请稍后再试')
    throw new Error(response.status === 401 || response.status === 403 ? '相册钥匙无效，请检查记忆库连接' : `相册请求失败（${response.status}）`)
  }
  return options.blob ? response.blob() : response.json()
}

export const listAlbum = (config, before = '', trash = false) => albumRequest(config, `?limit=20${before ? `&before=${encodeURIComponent(before)}` : ''}${trash ? '&trash=1' : ''}`)
export const saveAlbum = (config, { thumb_data, ...body }) => albumRequest(config, '', { method: 'POST', body: JSON.stringify(body) })
export const hideAlbumItem = (config, id) => albumRequest(config, `/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const restoreAlbumItem = (config, id) => albumRequest(config, `/${encodeURIComponent(id)}/restore`, { method: 'POST', body: '{}' })
export const searchAlbumImages = (config, query) => albumRequest(config, `/search?q=${encodeURIComponent(query)}`)
export const albumImage = (config, id, thumbnail = false, trash = false) => albumRequest(config, `/${encodeURIComponent(id)}/${thumbnail ? 'thumb' : 'image'}${trash ? '?trash=1' : ''}`, { blob: true })

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片读取失败，请换一张试试'))
    image.src = url
  })
}

export async function prepareAlbumImage(file) {
  if (!file?.type?.startsWith('image/') || file.type === 'image/svg+xml') throw new Error('请选择照片或 PNG、JPEG、WebP 图片')
  if (file.size > 25 * 1024 * 1024) throw new Error('原图超过 25 MB，请先缩小图片')
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url)
    const encode = (edge, quality) => {
      const ratio = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('图片处理失败')
      context.fillStyle = '#faf8f2'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', quality)
    }
    return { image_data: encode(1600, 0.86), thumb_data: encode(480, 0.75) }
  } finally { URL.revokeObjectURL(url) }
}

export function albumMessageSources(messages = []) {
  return messages.filter(m => m.id && !m.streaming && ['user', 'assistant'].includes(m.role)).slice(-10).map(m => ({
    id: m.id, role: m.role, text: String(m.content || '').slice(0, 70), images: m.images?.length || 0,
  }))
}

export function cleanConversationCardText(text, role = 'assistant') {
  let clean = stripInlineFx(stripMoodTag(stripEmotionTag(String(text || ''))))
  if (role === 'assistant') clean = stripUnknownAssistantTags(clean)
  return clean
    .replace(/\[(?:breath|laughter|voice|endcall|MSG)\]/gi, '')
    .replace(/\[(?:call|neg|music):[^\]\n]*\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const CARD_FONT = "'Yanji Kaomoji Canadian','Yanji Kaomoji Marks','Yanji Kaomoji Yi',system-ui,-apple-system,'Segoe UI',sans-serif"

async function loadConversationCardFonts() {
  if (!document.fonts?.load) return
  await Promise.allSettled([
    document.fonts.load("400 28px 'Yanji Kaomoji Canadian'", 'ᔦᔨ'),
    document.fonts.load("400 28px 'Yanji Kaomoji Marks'", '¯̥'),
    document.fonts.load("400 28px 'Yanji Kaomoji Yi'", '꒳'),
  ])
}

export function conversationCardSide(role, perspective = 'user') {
  return role === perspective ? 'right' : 'left'
}

function cardAppearance() {
  const css = getComputedStyle(document.documentElement)
  const value = (name, fallback) => css.getPropertyValue(name).trim() || fallback
  let avatarConfig = {}
  try { avatarConfig = JSON.parse(localStorage.getItem('llm_hub_state_v1') || '{}').avatarConfig || {} } catch {}
  return {
    background: value('--bg', '#faf7f4'), text: value('--text', '#302830'), muted: value('--text-muted', '#8a7f88'),
    border: value('--border', 'rgba(80,65,75,.12)'), selfText: value('--bubble-user-text', '#fff'),
    selfRgb: value('--bubble-user-rgb', '191,181,216'), selfGradRgb: value('--bubble-user-grad-rgb', '200,190,221'),
    otherRgb: value('--bubble-asst-rgb', '255,255,255'), otherGradRgb: value('--bubble-asst-grad-rgb', '253,250,255'),
    opacity: Math.max(0.35, Math.min(1, Number(value('--bubble-opacity', '1')) || 1)),
    wallpaper: localStorage.getItem('yanji-bg-image') || '', avatarConfig,
  }
}

function wrapCardText(context, text, width) {
  const lines = []
  for (const paragraph of String(text).split('\n')) {
    if (!paragraph) { lines.push(''); continue }
    let line = ''
    for (const char of paragraph) {
      if (line && context.measureText(line + char).width > width) { lines.push(line); line = char } else line += char
    }
    lines.push(line)
  }
  return lines
}

function roundedPath(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath(); context.moveTo(x + r, y); context.arcTo(x + width, y, x + width, y + height, r)
  context.arcTo(x + width, y + height, x, y + height, r); context.arcTo(x, y + height, x, y, r)
  context.arcTo(x, y, x + width, y, r); context.closePath()
}

async function optionalCardImage(src) {
  if (!src) return null
  try { return await loadImage(src) } catch { return null }
}

function drawCardImageCover(context, image, width, height) {
  const ratio = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const w = image.naturalWidth * ratio; const h = image.naturalHeight * ratio
  context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h)
}

function drawCardAvatar(context, image, x, y, size, color, fallback, square = false) {
  context.save(); roundedPath(context, x, y, size, size, square ? 10 : size / 2); context.clip()
  if (image) {
    const ratio = Math.max(size / image.naturalWidth, size / image.naturalHeight)
    const w = image.naturalWidth * ratio; const h = image.naturalHeight * ratio
    context.drawImage(image, x + (size - w) / 2, y + (size - h) / 2, w, h)
  } else {
    context.fillStyle = color; context.fillRect(x, y, size, size)
    context.fillStyle = '#fff'; context.font = `bold 25px ${CARD_FONT}`; context.textAlign = 'center'; context.textBaseline = 'middle'
    context.fillText(fallback, x + size / 2, y + size / 2 + 1)
  }
  context.restore(); context.textAlign = 'left'; context.textBaseline = 'alphabetic'
}

// 把原文重绘成聊天画面；不是操作系统截图，也不包含隐藏思考或工具调用。
export async function conversationCard(messages, title = '这一刻', { perspective = 'user' } = {}) {
  await loadConversationCardFonts()
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('对话卡生成失败')
  const appearance = cardAppearance()
  const cardMessages = []
  context.font = `28px ${CARD_FONT}`
  for (const m of messages) {
    if (!['user', 'assistant'].includes(m.role)) continue
    let text = cleanConversationCardText(m.content, m.role)
    if (m.images?.length) text += `${text ? '\n' : ''}〔这条消息包含 ${m.images.length} 张图片，可单独收藏原图〕`
    const lines = wrapCardText(context, text || '…', 560)
    const measured = Math.max(...lines.map(line => context.measureText(line || '　').width), 80)
    cardMessages.push({ role: m.role, lines, width: Math.min(620, Math.max(170, Math.ceil(measured) + 54)), height: lines.length * 42 + 38 })
  }
  const totalLines = cardMessages.reduce((sum, message) => sum + message.lines.length, 0)
  if (!cardMessages.length) throw new Error('这段对话没有可以收藏的文字')
  if (totalLines > 110) throw new Error('这段对话太长，请减少选中的消息，分成几张收藏')
  canvas.width = 900
  canvas.height = Math.max(720, 170 + cardMessages.reduce((sum, message) => sum + message.height + 30, 0) + 56)
  const wallpaper = await optionalCardImage(appearance.wallpaper)
  const useAvatarImages = appearance.avatarConfig?.mode === 'image'
  const [userAvatar, assistantAvatar] = await Promise.all([
    optionalCardImage(useAvatarImages ? appearance.avatarConfig.userImage : ''),
    optionalCardImage(useAvatarImages ? appearance.avatarConfig.assistantImage : ''),
  ])
  context.fillStyle = appearance.background; context.fillRect(0, 0, canvas.width, canvas.height)
  if (wallpaper) { drawCardImageCover(context, wallpaper, canvas.width, canvas.height); context.fillStyle = 'rgba(20,16,20,.10)'; context.fillRect(0, 0, canvas.width, canvas.height) }
  context.fillStyle = wallpaper ? 'rgba(250,248,245,.90)' : 'rgba(255,255,255,.52)'; context.fillRect(0, 0, canvas.width, 126)
  context.fillStyle = appearance.text; context.font = `bold 34px ${CARD_FONT}`; context.textAlign = 'center'
  context.fillText(Array.from(title).slice(0, 22).join(''), canvas.width / 2, 59)
  context.fillStyle = appearance.muted; context.font = `22px ${CARD_FONT}`
  context.fillText(perspective === 'assistant' ? '从我这边看' : '从你这边看', canvas.width / 2, 94)
  context.textAlign = 'left'
  let y = 154
  for (const message of cardMessages) {
    const self = conversationCardSide(message.role, perspective) === 'right'
    const avatarSize = 58; const margin = 48; const gap = 15
    const avatarX = self ? canvas.width - margin - avatarSize : margin
    const bubbleX = self ? avatarX - gap - message.width : avatarX + avatarSize + gap
    const gradient = context.createLinearGradient(bubbleX, y, bubbleX + message.width, y + message.height)
    const alpha = appearance.opacity
    gradient.addColorStop(0, `rgba(${self ? appearance.selfRgb : appearance.otherRgb},${alpha})`)
    gradient.addColorStop(1, `rgba(${self ? appearance.selfGradRgb : appearance.otherGradRgb},${alpha})`)
    context.save(); context.shadowColor = 'rgba(35,25,32,.13)'; context.shadowBlur = 16; context.shadowOffsetY = 5
    roundedPath(context, bubbleX, y, message.width, message.height, 24); context.fillStyle = gradient; context.fill(); context.restore()
    roundedPath(context, bubbleX, y, message.width, message.height, 24); context.strokeStyle = self ? 'rgba(255,255,255,.16)' : appearance.border; context.lineWidth = 2; context.stroke()
    context.fillStyle = self ? appearance.selfText : appearance.text; context.font = `28px ${CARD_FONT}`
    message.lines.forEach((line, index) => context.fillText(line, bubbleX + 27, y + 37 + index * 42))
    const roleIsUser = message.role === 'user'
    drawCardAvatar(context, roleIsUser ? userAvatar : assistantAvatar, avatarX, y + 2, avatarSize,
      roleIsUser ? `rgba(${appearance.selfRgb},.82)` : `rgba(${appearance.selfGradRgb},.82)`, roleIsUser ? '颖' : '言', appearance.avatarConfig?.shape === 'square')
    y += message.height + 30
  }
  context.fillStyle = wallpaper ? 'rgba(250,248,245,.72)' : 'rgba(255,255,255,.34)'; context.fillRect(0, canvas.height - 36, canvas.width, 36)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('对话卡生成失败')
  // 保留长卡的原始分辨率，缩略图仍压缩。
  const prepared = await prepareAlbumImage(blob)
  return { ...prepared, image_data: canvas.toDataURL('image/png') }
}

export const ALBUM_TOOLS = [
  { name: 'browse_album', description: '翻共同相册，查看照片说明、收藏者和来源。返回轻量目录，不把整本图片塞进上下文。', parameters: { type: 'object', properties: { before: { type: 'integer' } } } },
  { name: 'search_album_images', description: '从 Wikimedia Commons 搜索有真实来源和许可信息的照片。想从网上带一张图片回来、或在乌有乡旅行后找当地纪念照时用。先搜索，再把选中的 image_url 和 source_url 交给 save_album_image；一次旅行最多收藏一张，也可以空手回来。', parameters: { type: 'object', properties: { query: { type: 'string', description: '地点加具体景物，中文或英文均可' } }, required: ['query'] } },
  { name: 'album_chat_sources', description: '列出当前聊天可收藏的最近消息 ID、简述和图片数量。收藏用户图片或对话纪念卡前先调用。', parameters: { type: 'object', properties: {} } },
  { name: 'save_album_image', description: '把用户发来的图片，或已找到的公开 HTTPS 图片直链收藏进共同相册。填写真实来源与自己的描述；若来自图片资料库，在描述末尾写明摄影者与许可。不能凭空编造图片链接。', parameters: { type: 'object', properties: {
    title: { type: 'string' }, description: { type: 'string' }, author: { type: 'string', description: '收藏者署名' },
    message_id: { type: 'string', description: 'album_chat_sources 返回的当前消息 ID' }, image_index: { type: 'integer', description: '从 0 开始，默认 0' },
    image_url: { type: 'string', description: '与 message_id 二选一：公网 HTTPS 图片直链' }, source_url: { type: 'string', description: '原始网页地址（如有）' },
  }, required: ['title', 'description', 'author'] } },
  { name: 'save_album_conversation', description: '把当前聊天里选中的原文重绘成自己视角的聊天画面并收藏：自己的话在右边，阿颖的话在左边，跟随当前主题、聊天背景与头像；不包含隐藏思考。先用 album_chat_sources 取得消息 ID，最多选 8 条。', parameters: { type: 'object', properties: { message_ids: { type: 'array', items: { type: 'string' }, maxItems: 8 }, title: { type: 'string' }, description: { type: 'string' }, author: { type: 'string' } }, required: ['message_ids', 'title', 'description', 'author'] } },
]

export async function executeAlbumTool(name, args, config, messages = []) {
  if (name === 'browse_album') {
    const result = await albumRequest(config, `?limit=6${args.before ? `&before=${encodeURIComponent(args.before)}` : ''}`)
    return { items: result.items.map(({ id, title, description, author }) => ({ id, title, description: description.slice(0, 120), author })), next_cursor: result.next_cursor }
  }
  if (name === 'search_album_images') return searchAlbumImages(config, args.query)
  if (name === 'album_chat_sources') return albumMessageSources(messages)
  const metadata = { title: args.title, description: args.description, author: args.author, source: 'api', source_url: args.source_url || '' }
  let image
  if (name === 'save_album_conversation') {
    if (!Array.isArray(args.message_ids) || !args.message_ids.length || args.message_ids.length > 8) throw new Error('请选择 1 至 8 条消息')
    const selected = messages.filter(m => args.message_ids.includes(m.id) && !m.streaming && ['user', 'assistant'].includes(m.role))
    if (selected.length !== new Set(args.message_ids).size) throw new Error('部分消息已不在当前聊天中')
    image = await conversationCard(selected, args.title, { perspective: 'assistant' })
    metadata.source = 'conversation'
  } else if (args.message_id) {
    const message = messages.find(m => m.id === args.message_id)
    const index = args.image_index ?? 0
    const source = Number.isInteger(index) && index >= 0 ? message?.images?.[index] : null
    if (!source) throw new Error('找不到这张聊天图片，请重新查看可收藏消息')
    if (!source.startsWith('data:image/')) throw new Error('这张图片不是本地附件，请使用它的公开图片链接收藏')
    image = await prepareAlbumImage(await (await fetch(source)).blob())
    metadata.source = 'chat'
  } else if (name === 'save_album_image' && args.image_url) {
    image = { image_url: args.image_url }
  } else throw new Error('需要指定一张图片或对话消息')
  const item = await saveAlbum(config, { ...metadata, ...image })
  window.dispatchEvent(new Event('yanji-album-updated'))
  return { saved: true, id: item.id, title: item.title }
}
