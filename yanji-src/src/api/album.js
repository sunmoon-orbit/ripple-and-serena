// 图片经过鉴权读取，令牌不放进图片 URL；列表只返回描述与缩略图地址。
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

export const listAlbum = (config, before = '') => albumRequest(config, `?limit=20${before ? `&before=${encodeURIComponent(before)}` : ''}`)
export const saveAlbum = (config, { thumb_data, ...body }) => albumRequest(config, '', { method: 'POST', body: JSON.stringify(body) })
export const hideAlbumItem = (config, id) => albumRequest(config, `/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const albumImage = (config, id, thumbnail = false) => albumRequest(config, `/${encodeURIComponent(id)}/${thumbnail ? 'thumb' : 'image'}`, { blob: true })

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

// 本地原文排成纪念卡；不是操作系统截图，也不包含隐藏的思考或工具调用。
export async function conversationCard(messages, title = '这一刻') {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('对话卡生成失败')
  const lines = []
  context.font = '28px sans-serif'
  for (const m of messages) {
    if (!['user', 'assistant'].includes(m.role)) continue
    lines.push({ text: m.role === 'user' ? '我' : '你', label: true })
    for (const paragraph of String(m.content || '').split('\n')) {
      let line = ''
      for (const char of paragraph) {
        if (context.measureText(line + char).width > 760) { lines.push({ text: line }); line = '' }
        line += char
      }
      lines.push({ text: line })
    }
    if (m.images?.length) lines.push({ text: `〔这条消息包含 ${m.images.length} 张图片，可单独收藏原图〕` })
    lines.push({ text: '' })
  }
  if (lines.length > 110) throw new Error('这段对话太长，请减少选中的消息，分成几张收藏')
  canvas.width = 900
  canvas.height = Math.max(480, 210 + lines.length * 44)
  context.fillStyle = '#faf8f2'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#4e695d'; context.font = 'bold 34px sans-serif'
  context.fillText(Array.from(title).slice(0, 22).join(''), 70, 80)
  lines.forEach((line, i) => {
    context.font = line.label ? 'bold 24px sans-serif' : '28px sans-serif'
    context.fillStyle = line.label ? '#7f8e82' : '#302e29'
    context.fillText(line.text, 70, 150 + i * 44)
  })
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('对话卡生成失败')
  // 保留长卡的原始分辨率，缩略图仍压缩。
  const prepared = await prepareAlbumImage(blob)
  return { ...prepared, image_data: canvas.toDataURL('image/png') }
}

export const ALBUM_TOOLS = [
  { name: 'browse_album', description: '翻共同相册，查看照片说明、收藏者和来源。返回轻量目录，不把整本图片塞进上下文。', parameters: { type: 'object', properties: { before: { type: 'integer' } } } },
  { name: 'album_chat_sources', description: '列出当前聊天可收藏的最近消息 ID、简述和图片数量。收藏用户图片或对话纪念卡前先调用。', parameters: { type: 'object', properties: {} } },
  { name: 'save_album_image', description: '把用户发来的图片，或已找到的公开 HTTPS 图片直链收藏进共同相册。填写真实来源与自己的描述。不能凭空编造图片链接。', parameters: { type: 'object', properties: {
    title: { type: 'string' }, description: { type: 'string' }, author: { type: 'string', description: '收藏者署名' },
    message_id: { type: 'string', description: 'album_chat_sources 返回的当前消息 ID' }, image_index: { type: 'integer', description: '从 0 开始，默认 0' },
    image_url: { type: 'string', description: '与 message_id 二选一：公网 HTTPS 图片直链' }, source_url: { type: 'string', description: '原始网页地址（如有）' },
  }, required: ['title', 'description', 'author'] } },
  { name: 'save_album_conversation', description: '把当前聊天里选中的原文排成对话纪念卡并收藏。不是屏幕截图，不包含隐藏思考。先用 album_chat_sources 取得消息 ID，最多选 8 条。', parameters: { type: 'object', properties: { message_ids: { type: 'array', items: { type: 'string' }, maxItems: 8 }, title: { type: 'string' }, description: { type: 'string' }, author: { type: 'string' } }, required: ['message_ids', 'title', 'description', 'author'] } },
]

export async function executeAlbumTool(name, args, config, messages = []) {
  if (name === 'browse_album') {
    const result = await albumRequest(config, `?limit=6${args.before ? `&before=${encodeURIComponent(args.before)}` : ''}`)
    return { items: result.items.map(({ id, title, description, author }) => ({ id, title, description: description.slice(0, 120), author })), next_cursor: result.next_cursor }
  }
  if (name === 'album_chat_sources') return albumMessageSources(messages)
  const metadata = { title: args.title, description: args.description, author: args.author, source: 'api', source_url: args.source_url || '' }
  let image
  if (name === 'save_album_conversation') {
    if (!Array.isArray(args.message_ids) || !args.message_ids.length || args.message_ids.length > 8) throw new Error('请选择 1 至 8 条消息')
    const selected = messages.filter(m => args.message_ids.includes(m.id) && !m.streaming && ['user', 'assistant'].includes(m.role))
    if (selected.length !== new Set(args.message_ids).size) throw new Error('部分消息已不在当前聊天中')
    image = await conversationCard(selected, args.title)
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
