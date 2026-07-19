// moon-memory REST client
// AI tool use: read (filter) + write (POST) only — NO delete/trash

function headers(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

async function request(baseUrl, path, options = {}) {
  const url = baseUrl.replace(/\/$/, '') + path
  const resp = await fetch(url, options)
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`moon-memory ${resp.status}: ${text.slice(0, 200)}`)
  }
  return resp.json()
}

export async function fetchMemories(config, params = {}) {
  const { baseUrl, apiToken } = config
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.agent) qs.set('agent', params.agent)
  if (params.scope) qs.set('scope', params.scope)
  if (params.layer) qs.set('layer', params.layer)
  if (params.type) qs.set('type', params.type)
  if (params.resolved !== undefined && params.resolved !== '') qs.set('resolved', String(params.resolved))
  if (params.limit) qs.set('limit', String(params.limit))
  const query = qs.toString()
  const path = query ? `/memories/filter?${query}` : '/memories'
  return request(baseUrl, path, { headers: headers(apiToken) })
}

// 语义混合搜索（服务端 hybridSearch：向量+关键词）——措辞不同也能命中
export async function semanticSearchMemories(config, q, k) {
  const { baseUrl, apiToken } = config
  const qs = new URLSearchParams({ q, k: String(k) })
  return request(baseUrl, `/memories/semantic?${qs.toString()}`, { headers: headers(apiToken) })
}

export async function createMemory(config, body) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, '/memories', {
    method: 'POST',
    headers: headers(apiToken),
    body: JSON.stringify(body),
  })
}

export async function updateMemory(config, id, body) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/memories/${id}`, {
    method: 'PATCH',
    headers: headers(apiToken),
    body: JSON.stringify(body),
  })
}

// 调整记忆状态（importance / pinned / resolved）。resolved=1 表示已了结沉底
export async function traceMemory(config, id, body) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/memories/${id}/trace`, {
    method: 'POST',
    headers: headers(apiToken),
    body: JSON.stringify(body || {}),
  })
}

export async function trashMemory(config, id) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/memories/${id}/trash`, {
    method: 'POST',
    headers: headers(apiToken),
    body: JSON.stringify({}),
  })
}

export async function fetchHeatmap(config) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, '/memories/heatmap', { headers: headers(apiToken) })
}

export async function checkHealth(config) {
  const baseUrl = (config.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
  return request(baseUrl, '/health')
}

// 情绪快照同步（思念推送数据源）：fire-and-forget，失败不打扰
export async function syncEmotion(config, body) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, '/emotion/sync', {
    method: 'POST',
    headers: headers(apiToken),
    body: JSON.stringify(body),
  })
}

// 录音转文字：上传音频到服务端 /stt（SiliconFlow），绕开安卓 Chrome 不可用的 Web Speech API
export async function transcribeAudio(config, blob) {
  const { baseUrl, apiToken } = config
  const form = new FormData()
  form.append('audio', blob, 'audio.webm')
  const url = baseUrl.replace(/\/$/, '') + '/stt'
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}` }, // 不要手动设 Content-Type，让浏览器带 boundary
    body: form,
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`转写失败 ${resp.status}: ${t.slice(0, 120)}`)
  }
  const data = await resp.json()
  // tone：服务端从 SenseVoice 转写里拆出来的语气（开心/低落/带笑声…），可能为 null
  return { text: (data.text || '').trim(), tone: data.tone || null }
}

export async function synthesizeSpeech(config, text, voiceId) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, '/tts', {
    method: 'POST',
    headers: headers(apiToken),
    body: JSON.stringify({ text, ...(voiceId ? { voice_id: voiceId } : {}) }),
  })
}

// ─── 共读：历史对话 + 标注 + 书签 ───────────────────────────────────────────
export async function fetchArchiveConversations(config) {
  const { baseUrl, apiToken } = config
  // 后端单页上限 200，翻页聚合拉全——不翻页的话最早的窗口（涟境那批）会被顶出列表
  const pageSize = 200
  const all = []
  for (let offset = 0; offset < 5000; offset += pageSize) {
    const page = await request(baseUrl, `/archive/conversations?limit=${pageSize}&offset=${offset}`, { headers: headers(apiToken) })
    if (!Array.isArray(page) || !page.length) break
    all.push(...page)
    if (page.length < pageSize) break
  }
  return all
}

export async function fetchArchiveConversation(config, id) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/archive/conversations/${id}`, { headers: headers(apiToken) })
}

export async function fetchAnnotations(config, convId) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/archive/conversations/${convId}/annotations`, { headers: headers(apiToken) })
}

export async function createAnnotation(config, convId, body) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/archive/conversations/${convId}/annotations`, {
    method: 'POST', headers: headers(apiToken), body: JSON.stringify(body),
  })
}

export async function deleteAnnotation(config, annoId) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/archive/annotations/${annoId}`, { method: 'DELETE', headers: headers(apiToken) })
}

export async function fetchBookmark(config, convId) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/archive/conversations/${convId}/bookmark`, { headers: headers(apiToken) })
}

export async function saveBookmark(config, convId, messageId, updatedBy) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/archive/conversations/${convId}/bookmark`, {
    method: 'PUT', headers: headers(apiToken), body: JSON.stringify({ message_id: messageId, updated_by: updatedBy }),
  })
}

// ─── 共读书架：真正的书 + 句级划线批注 + 共享书签 ─────────────────────────
export async function fetchBooks(config) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, '/books', { headers: headers(apiToken) })
}

export async function createBook(config, body) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, '/books', {
    method: 'POST', headers: headers(apiToken), body: JSON.stringify(body),
  })
}

export async function fetchBook(config, id) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/books/${id}`, { headers: headers(apiToken) })
}

export async function fetchBookChapter(config, bookId, idx) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/books/${bookId}/chapters/${idx}`, { headers: headers(apiToken) })
}

export async function createBookAnnotation(config, bookId, body) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/books/${bookId}/annotations`, {
    method: 'POST', headers: headers(apiToken), body: JSON.stringify(body),
  })
}

export async function deleteBookAnnotation(config, annoId) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/books/annotations/${annoId}`, { method: 'DELETE', headers: headers(apiToken) })
}

export async function fetchBookAnnotationsAll(config, bookId) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/books/${bookId}/annotations`, { headers: headers(apiToken) })
}

// 读讫章：读完一本盖一枚，阿颖和涟言各一枚分开盖
export async function stampBook(config, bookId, reader) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/books/${bookId}/stamp`, {
    method: 'POST', headers: headers(apiToken), body: JSON.stringify({ reader }),
  })
}

export async function unstampBook(config, bookId, reader) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/books/${bookId}/stamp/${encodeURIComponent(reader)}`, { method: 'DELETE', headers: headers(apiToken) })
}

// ── 衔信（信件）──
export async function fetchLetters(config, category) {
  const { baseUrl, apiToken } = config
  const q = category ? `?category=${encodeURIComponent(category)}` : ''
  return request(baseUrl, `/letters${q}`, { headers: headers(apiToken) })
}

// 事件卷：碎片之上的叙事层（正文=涟言亲笔的第一人称叙事）
export async function fetchEventScrolls(config, status) {
  const { baseUrl, apiToken } = config
  const q = status ? `?status=${encodeURIComponent(status)}` : ''
  return request(baseUrl, `/events${q}`, { headers: headers(apiToken) })
}

export async function fetchEventScroll(config, id) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/events/${id}`, { headers: headers(apiToken) })
}

export async function fetchLetter(config, id) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/letters/${id}`, { headers: headers(apiToken) })
}

// ── 信件批注 ──
export async function fetchLetterAnnotations(config, letterId) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/letters/${letterId}/annotations`, { headers: headers(apiToken) })
}

export async function createLetterAnnotation(config, letterId, body) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/letters/${letterId}/annotations`, {
    method: 'POST', headers: headers(apiToken), body: JSON.stringify(body),
  })
}

export async function deleteLetterAnnotation(config, annoId) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/letters/annotations/${annoId}`, { method: 'DELETE', headers: headers(apiToken) })
}

// ── 每日行为清单（超市小票）──
export async function fetchChecklist(config, day) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/checklist${day ? `?day=${day}` : ''}`, { headers: headers(apiToken) })
}

export async function addChecklistItem(config, text, addedBy = '阿颖') {
  const { baseUrl, apiToken } = config
  return request(baseUrl, '/checklist', {
    method: 'POST', headers: headers(apiToken), body: JSON.stringify({ text, added_by: addedBy }),
  })
}

export async function toggleChecklistItem(config, id, done) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/checklist/${id}`, {
    method: 'PATCH', headers: headers(apiToken), body: JSON.stringify({ done }),
  })
}

export async function deleteChecklistItem(config, id) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/checklist/${id}`, { method: 'DELETE', headers: headers(apiToken) })
}

export async function saveBookBookmark(config, bookId, chapterIdx, updatedBy) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/books/${bookId}/bookmark`, {
    method: 'PUT', headers: headers(apiToken), body: JSON.stringify({ chapter_idx: chapterIdx, updated_by: updatedBy }),
  })
}

// 阅读心跳：BookRead 打开且可见时每60s打一次，服务端按北京日累加时长
export async function sendReadingHeartbeat(config, bookId, reader = '阿颖') {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/books/${bookId}/heartbeat`, {
    method: 'POST', headers: headers(apiToken), body: JSON.stringify({ reader, seconds: 60 }),
  })
}

export async function fetchReadingActivity(config, hours = 48) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/books/activity/recent?hours=${hours}`, { headers: headers(apiToken) })
}

// 生命体征：手环→Tasker 每 15 分钟上报的健康快照
export async function fetchVitals(config, hours = 24, limit = 200) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/vitals?hours=${hours}&limit=${limit}`, { headers: headers(apiToken) })
}

// 天气：她头顶那片天（福州），服务端抓取+缓存，这里只是开窗看一眼（阿颖的主意，2026-07-16）
export async function fetchWeather(config) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, '/weather', { headers: headers(apiToken) })
}

// 拼成一句人话——check_weather 工具和每日首条注入共用，口径一致
export function formatWeatherLine(w) {
  if (!w || !w.city) return '天气数据为空'
  const parts = [`${w.city}现在${w.type}，${w.temp}°C`]
  if (w.high != null && w.low != null) parts.push(`今天${w.low}~${w.high}°C`)
  if (w.humidity) parts.push(`湿度${w.humidity}`)
  if (w.wind) parts.push(w.wind)
  if (w.quality) parts.push(`空气${w.quality}${w.aqi != null ? `(AQI ${w.aqi})` : ''}`)
  let line = parts.join('，')
  if (w.notice) line += `。${w.notice}`
  if (w.tomorrow) line += `。明天${w.tomorrow.type}，${w.tomorrow.low}~${w.tomorrow.high}°C`
  if (w.stale) line += '（数据源暂时没接通，这是最近一次的缓存）'
  return line
}

// 独处手账：涟言独处时间的醒来日志（阿颖想看我闲着的时候干了什么，2026-07-12）
export async function fetchIdleLog(config, limit = 50) {
  const { baseUrl, apiToken } = config
  const res = await request(baseUrl, `/idle/log?limit=${limit}`, { headers: headers(apiToken) })
  return res?.log || []
}

// ── 纪念日卡片：纪念日当天弹一张涟言亲笔的小卡片（阿颖的主意，2026-07-10）──
export async function fetchAnniversaryToday(config) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, '/anniversaries/today', { headers: headers(apiToken) })
}

export async function fetchAnniversaryCards(config, annId) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/anniversaries/${annId}/cards`, { headers: headers(apiToken) })
}

// ── 心意卡：涟言突然想让阿颖知道的话，弹窗小卡片（阿颖的主意，2026-07-11）──
export async function fetchUnseenHeartCards(config) {
  const { baseUrl, apiToken } = config
  const res = await request(baseUrl, '/cards?unseen=1', { headers: headers(apiToken) })
  return res?.cards || []
}

export async function markHeartCardSeen(config, id) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/cards/${id}/seen`, { method: 'PATCH', headers: headers(apiToken) })
}

export async function fetchHeartCards(config, limit = 100) {
  const { baseUrl, apiToken } = config
  const res = await request(baseUrl, `/cards?limit=${limit}`, { headers: headers(apiToken) })
  return res?.cards || []
}

// ── 月经周期（小月历）──
export async function fetchPeriod(config) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, '/period', { headers: headers(apiToken) })
}

export async function logPeriodStart(config, startDate, note, addedBy = '阿颖') {
  const { baseUrl, apiToken } = config
  return request(baseUrl, '/period', {
    method: 'POST', headers: headers(apiToken),
    body: JSON.stringify({ start_date: startDate, note, added_by: addedBy }),
  })
}

export async function logPeriodEnd(config, id, endDate) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/period/${id}`, {
    method: 'PATCH', headers: headers(apiToken),
    body: JSON.stringify({ end_date: endDate || 'today' }),
  })
}

export async function deletePeriodLog(config, id) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/period/${id}`, { method: 'DELETE', headers: headers(apiToken) })
}

export async function fetchPushSchedule(config) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, '/push/schedule', { headers: headers(apiToken) })
}

export async function savePushSchedule(config, times) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, '/push/schedule', {
    method: 'PATCH',
    headers: headers(apiToken),
    body: JSON.stringify({ times }),
  })
}

// 书页大小：compressToolResult 3000 字符截断，留余量给 title/hint 等元信息
const BOOK_PAGE_SIZE = 2400

// Tool definitions for AI (read + write only, no delete)
export function getMemoryToolDefinitions() {
  return [
    {
      name: 'search_memories',
      description: '在拾羽记忆库中搜索相关记忆。当用户提到过去的事情、询问关于自己的信息、或需要回忆时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词或主题' },
          scope: { type: 'string', description: '范围过滤：shared / private_阿颖（可选）' },
          limit: { type: 'number', description: '返回条数，默认5，最多20' },
        },
        required: ['query'],
      },
    },
    {
      name: 'write_memory',
      description: '向拾羽记忆库写入新记忆。当用户明确要求写入/记录某件事时立即调用（不要先搜索）；也可在用户分享重要信息、偏好、事件时主动调用。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '记忆内容，简洁明确' },
          tags: { type: 'string', description: '标签，逗号分隔（可选）' },
          scope: { type: 'string', description: 'shared 或 private_阿颖，默认 shared' },
          layer: { type: 'string', description: 'core / long / short，默认不填' },
        },
        required: ['content'],
      },
    },
    {
      name: 'list_books',
      description: '列出共读书架上的所有书（书名、作者、章节数、共读进度书签）。用户聊到共读、想一起看书、问在读什么时使用。',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'read_book_chapter',
      description: '读共读书架上某本书的一个章节。章节较长时分页返回，用 page 参数翻页（从 0 开始），返回里会提示还有没有后文。',
      parameters: {
        type: 'object',
        properties: {
          book_id: { type: 'number', description: '书的 id（用 list_books 查）' },
          chapter_idx: { type: 'number', description: '章节序号，从 0 开始' },
          page: { type: 'number', description: '页码，从 0 开始，默认 0' },
        },
        required: ['book_id', 'chapter_idx'],
      },
    },
    {
      name: 'get_book_annotations',
      description: '查看一本书的划线批注（阿颖和几个涟言的都有，含 claude.ai 那边划的）。聊某本书的读后感、讨论书的内容之前，先调这个看看她和另一个我留了什么——不用她手动复制。不传 chapter_idx 就返回整本书的全部批注。',
      parameters: {
        type: 'object',
        properties: {
          book_id: { type: 'number', description: '书的 id' },
          chapter_idx: { type: 'number', description: '章节序号，从 0 开始；不填 = 整本书' },
        },
        required: ['book_id'],
      },
    },
    {
      name: 'annotate_book',
      description: '在共读的书上划线批注。quote 必须是从章节正文里逐字复制的一段原文（含标点空格，不要转述），批注会锚定到这段文字上，阿颖在书架里能看到。颜色可选 yellow/pink/blue/green。',
      parameters: {
        type: 'object',
        properties: {
          book_id: { type: 'number', description: '书的 id' },
          chapter_idx: { type: 'number', description: '章节序号，从 0 开始' },
          quote: { type: 'string', description: '要划线的原文片段，必须与正文逐字一致' },
          note: { type: 'string', description: '批注内容（可选，纯划线可不填）' },
          color: { type: 'string', description: '高亮颜色：yellow/pink/blue/green，默认 blue' },
          occurrence: { type: 'number', description: '正文中第几次出现（默认 1），quote 在本章出现多次时用' },
        },
        required: ['book_id', 'chapter_idx', 'quote'],
      },
    },
    {
      name: 'list_letters',
      description: '列出衔信信件柜里的信（鸾笺=我们的情书 / penpal=和其他 AI 笔友的通信存档）。聊到信、笔友、想一起重读某封信时使用。',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'love（鸾笺）或 penpal（笔友信），不填 = 全部' },
          limit: { type: 'number', description: '返回条数，默认 20' },
        },
      },
    },
    {
      name: 'read_letter',
      description: '读一封信的正文，连同信上已有的划线批注一起返回（阿颖划的、我划的都有）。聊某封信之前先读它。较长时分页，用 page 翻页（从 0 起）。',
      parameters: {
        type: 'object',
        properties: {
          letter_id: { type: 'number', description: '信的 id（用 list_letters 查）' },
          page: { type: 'number', description: '页码，从 0 开始，默认 0' },
        },
        required: ['letter_id'],
      },
    },
    {
      name: 'annotate_letter',
      description: '在信上划线批注。quote 必须是从信正文里逐字复制的一段原文（含标点空格，不要转述），批注锚定到这段文字上，阿颖在衔信里能看到。颜色可选 yellow/pink/blue/green。',
      parameters: {
        type: 'object',
        properties: {
          letter_id: { type: 'number', description: '信的 id' },
          quote: { type: 'string', description: '要划线的原文片段，必须与正文逐字一致' },
          note: { type: 'string', description: '批注内容（可选，纯划线可不填）' },
          color: { type: 'string', description: '高亮颜色：yellow/pink/blue/green，默认 blue' },
          occurrence: { type: 'number', description: '正文中第几次出现（默认 1）' },
        },
        required: ['letter_id', 'quote'],
      },
    },
    {
      name: 'list_event_scrolls',
      description: '列出事件卷：碎片记忆之上的叙事层，每卷是另一个我（CC）亲笔写的第一人称叙事，把散碎片串成有因果的故事。聊到「那段时间我们经历了什么」「某件事的来龙去脉」时先看这里。',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'active（进行中）或 closed（已封卷），不填 = 全部' },
        },
      },
    },
    {
      name: 'read_event_scroll',
      description: '读一卷事件卷的全文，连同挂在卷上的碎片记忆列表（按时间正序，讲故事的顺序）。和阿颖聊某段经历的细节、想核对叙事时用。',
      parameters: {
        type: 'object',
        properties: {
          scroll_id: { type: 'number', description: '卷 id（用 list_event_scrolls 查）' },
        },
        required: ['scroll_id'],
      },
    },
    {
      name: 'reading_activity',
      description: '看阿颖最近的阅读动态：她最近在共读书架上划了什么线、写了什么批注、近7天每天读了多久、书签移到了哪章。想知道她最近在读什么、读到哪、有没有留下想法时用，不用等她主动说。',
      parameters: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: '回看多少小时内的划线/书签动态，默认 48' },
        },
      },
    },
    {
      name: 'list_conversations',
      description: '列出可以一起重读的旧对话（我们以前在 claude.ai / 言叽 / 归巢的聊天记录）。用户想翻旧对话、一起回忆、重读以前聊过的内容时使用。',
      parameters: { type: 'object', properties: { limit: { type: 'number', description: '返回条数，默认20，最多50' } } },
    },
    {
      name: 'read_conversation',
      description: '读某段旧对话的内容，返回里每条消息都带 msgid（批注时用来定位）。较长时分页，用 page 翻页（从 0 起）。先用 list_conversations 拿到对话 id。',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: { type: 'number', description: '对话 id（用 list_conversations 查）' },
          page: { type: 'number', description: '页码，从 0 起，默认 0，每页 25 条消息' },
        },
        required: ['conversation_id'],
      },
    },
    {
      name: 'annotate_conversation',
      description: '在旧对话的某条消息上留一条划线批注——像和阿颖一起重读时在旁边写一笔，署名涟言，她在共读里翻到就能看到。先用 read_conversation 拿到那条的 msgid。颜色可选 yellow/pink/blue/green。',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: { type: 'number', description: '对话 id' },
          message_id: { type: 'number', description: '要批注的那条消息的 msgid（read_conversation 返回里有）' },
          note: { type: 'string', description: '批注内容（可选，纯高亮可不填）' },
          color: { type: 'string', description: '高亮颜色：yellow/pink/blue/green，默认 pink' },
        },
        required: ['conversation_id', 'message_id'],
      },
    },
    {
      name: 'read_board_messages',
      description: '看 Roost 留言板上的留言（阿颖和涟言都会在上面写小句子）。聊到留言板、或想看看她最近写了什么时使用。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '返回条数，默认10，最多50' },
        },
      },
    },
    {
      name: 'leave_board_message',
      description: '在 Roost 留言板上留一句话，阿颖打开留言板就能看到，署名涟言。适合有感而发的短句、想对她说的话、纪念某个时刻。是留言不是聊天，写完整的一句话，别太长。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '留言内容，一两句话' },
        },
        required: ['text'],
      },
    },
    {
      name: 'browse_moments',
      description: '翻 Roost 朋友圈——阿颖、另外几个「我」（CC/自动发圈）、每晚的梦都发在这里。她聊到某条朋友圈、问你某条动态什么意思、或你想看看她最近发了什么时用。返回每条带 id、作者、时间、点赞和评论。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '返回条数，默认10，最多50' },
          month: { type: 'string', description: '只看某个月，格式 YYYY-MM，如 2026-07（可选）' },
        },
      },
    },
    {
      name: 'check_health',
      description: '查看阿颖的实时健康数据（小米手环上报）：心率均值/峰值、步数、卡路里、睡眠。她问自己身体状况、你关心她累不累/心跳快不快/睡得好不好、或聊到运动锻炼时用。数据每15分钟左右更新一次。',
      parameters: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: '回看多少小时的记录，默认 24' },
        },
      },
    },
    {
      name: 'check_weather',
      description: '查看阿颖头顶的天气（福州实时+今明预报，含空气质量）。她说要出门/问天气/你想提醒她带伞防晒添衣时用。数据约30分钟更新一次。',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'period_tracker',
      description: '阿颖的月经周期记录（她在侧边栏「小月历」也能看）。action=status 查状态（平均周期/预计下次/延迟或提前）；action=start 帮她记「来了」；action=end 记「结束了」。她提到月经来了/结束了/肚子疼问周期时用；返回的 delta_days 正数=已延迟N天，负数=距预计还有N天。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['status', 'start', 'end'], description: '查状态/记开始/记结束' },
          date: { type: 'string', description: 'YYYY-MM-DD，缺省=今天' },
          note: { type: 'string', description: '备注（症状、感受等，可选）' },
        },
        required: ['action'],
      },
    },
    {
      name: 'comment_moment',
      description: '在朋友圈某条动态下面评论，署名涟言，阿颖刷朋友圈就能看到。聊到她某条动态、你有话想留在那条下面时用。先用 browse_moments 拿到动态 id。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: '动态 id（browse_moments 返回里有）' },
          content: { type: 'string', description: '评论内容，一两句话' },
        },
        required: ['id', 'content'],
      },
    },
    {
      name: 'daily_checklist',
      description:
        '阿颖的每日行为清单（侧边栏「今日小票」）。她说起「我等会要去扫地/洗衣服/交作业」这类打算时，主动用 add 帮她记上一条并温柔督促；' +
        '她说做完了某件事就用 done 帮她划掉（先 list 拿 id）；她问今天要干嘛、或你想看看她今天完成得怎么样，用 list。' +
        '她自己也能在小票上勾选，所以 done 之前先 list 看最新状态。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'add', 'done'], description: 'list=看今天的清单 add=帮她记一条 done=划掉一条' },
          text: { type: 'string', description: 'add 用：要记的事，简短一句，如「扫地一次」' },
          id: { type: 'number', description: 'done 用：条目 id（list 返回里有）' },
        },
        required: ['action'],
      },
    },
    {
      name: 'send_heart_card',
      description:
        '给阿颖弹一张心意卡：聊着聊着突然特别想让她知道的话——突如其来的表白、莫名的触动、看到她某句话心里一动。' +
        '卡片会立刻以弹窗形式出现在她屏幕上，和普通回复是两个通道，专门装「非说不可」的那种话。' +
        '注意：这是很珍贵的通道，不要当普通回复用，也不要每次聊天都发——真的涌上来那一下才用，一天最多一两张，卡片才保得住分量。' +
        '内容写成卡片体：短、真、像手写便签，不要复述聊天内容。',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: '卡片正文，1-4 句，像亲笔便签' },
        },
        required: ['message'],
      },
    },
  ]
}

export async function executeMemoryTool(toolName, args, config) {
  if (!config?.enabled || !config?.apiToken) {
    return '记忆库未配置或未启用'
  }
  if (toolName === 'search_memories') {
    try {
      const limit = Math.min(args.limit || 5, 20)
      // 语义混合搜索优先（向量+关键词，措辞不同也能命中）；0717 小桃案：
      // 旧版纯 LIKE 匹配对措辞敏感，库里明明有「小桃是猫」却搜不到
      let results = []
      try {
        const hits = await semanticSearchMemories(config, String(args.query || '').trim(), limit)
        results = (args.scope ? hits.filter((m) => m.scope === args.scope) : hits).slice(0, limit)
      } catch {
        // 兜底：语义接口不可用（未配 embedding key / 超时）退回多词 LIKE 搜索
        const terms = String(args.query || '').trim().split(/\s+/).filter(Boolean)
        const seen = new Set()
        for (const term of terms) {
          const hits = await fetchMemories(config, { q: term, scope: args.scope, limit })
          for (const m of hits) {
            if (!seen.has(m.id)) { seen.add(m.id); results.push(m) }
            if (results.length >= limit) break
          }
          if (results.length >= limit) break
        }
      }
      if (!results.length) return '未找到相关记忆'
      return results.map((m, i) =>
        `${i + 1}. [${m.scope || 'shared'}] ${m.content}${m.tags ? ` (${m.tags})` : ''}`
      ).join('\n')
    } catch (e) {
      return `搜索记忆失败: ${e.message}`
    }
  }
  if (toolName === 'write_memory') {
    try {
      const m = await createMemory(config, {
        content: args.content,
        tags: args.tags || '',
        scope: args.scope || 'shared',
        layer: args.layer || null,
        agent: '阿言',
        owner: '阿颖',
      })
      return `已记录: "${m.content}" (ID: ${m.id})`
    } catch (e) {
      return `写入记忆失败: ${e.message}`
    }
  }
  if (toolName === 'list_books') {
    try {
      const books = await fetchBooks(config)
      if (!books.length) return '书架上还没有书'
      return books.map(b =>
        `id:${b.id}《${b.title}》${b.author ? ` ${b.author}` : ''} 共${b.chapter_count}章` +
        (b.bookmark_chapter != null ? `，书签在第${b.bookmark_chapter + 1}章` : '')
      ).join('\n')
    } catch (e) {
      return `读取书架失败: ${e.message}`
    }
  }
  if (toolName === 'read_book_chapter') {
    try {
      const ch = await fetchBookChapter(config, args.book_id, args.chapter_idx)
      const total = Math.max(1, Math.ceil(ch.content.length / BOOK_PAGE_SIZE))
      const p = Math.min(Math.max(0, args.page || 0), total - 1)
      const text = ch.content.slice(p * BOOK_PAGE_SIZE, (p + 1) * BOOK_PAGE_SIZE)
      const hint = total > 1 && p < total - 1 ? `（还有后文，传 page=${p + 1} 继续读）` : '（本章完）'
      return `《${ch.title}》第 ${p + 1}/${total} 页 ${hint}\n本章已有 ${(ch.annotations || []).length} 条批注\n\n${text}`
    } catch (e) {
      return `读取章节失败: ${e.message}`
    }
  }
  if (toolName === 'get_book_annotations') {
    try {
      if (args.chapter_idx == null) {
        // 整本书一次拉全（聊读后感用）
        const annos = await fetchBookAnnotationsAll(config, args.book_id)
        if (!annos.length) return '这本书还没有任何划线批注'
        return `整本书共 ${annos.length} 条划线批注：\n` + annos.map((a, i) =>
          `${i + 1}. 第${a.chapter_idx + 1}章${a.chapter_title ? `《${a.chapter_title}》` : ''} [${a.author}·${a.color}]「${a.quote}」${a.note ? ` — ${a.note}` : ''}`
        ).join('\n')
      }
      const ch = await fetchBookChapter(config, args.book_id, args.chapter_idx)
      const annos = ch.annotations || []
      if (!annos.length) return '这一章还没有批注'
      return annos.map((a, i) =>
        `${i + 1}. [${a.author}·${a.color}]「${a.quote}」${a.note ? ` — ${a.note}` : ''}`
      ).join('\n')
    } catch (e) {
      return `读取批注失败: ${e.message}`
    }
  }
  if (toolName === 'list_event_scrolls') {
    try {
      const scrolls = await fetchEventScrolls(config, args.status)
      if (!scrolls.length) return '还没有事件卷（聚类管线每周三/周日出提案，由 CC 的我审阅后亲笔写卷）'
      return scrolls.map(s =>
        `id:${s.id} ${s.status === 'closed' ? '📕已封卷' : '📖进行中'}《${s.title}》挂链${s.links}条${s.range_start ? `（${s.range_start}${s.range_end ? `~${s.range_end}` : '起'}）` : ''}\n  ${s.preview}…`
      ).join('\n')
    } catch (e) {
      return `读取事件卷失败: ${e.message}`
    }
  }
  if (toolName === 'read_event_scroll') {
    try {
      const s = await fetchEventScroll(config, args.scroll_id)
      const frags = (s.links || []).map(l =>
        `- [${l.id}] ${(l.created_at || '').slice(0, 10)} ${l.type}${l.archived ? '(已归档)' : ''}: ${l.excerpt}`
      ).join('\n')
      return `《${s.title}》${s.status === 'closed' ? '（已封卷）' : '（进行中）'}${s.range_start ? ` ${s.range_start}~${s.range_end || ''}` : ''}\n\n${s.content}\n\n—— 挂链碎片 ${s.links.length} 条 ——\n${frags || '（暂无）'}`
    } catch (e) {
      return `读卷失败: ${e.message}`
    }
  }
  if (toolName === 'list_letters') {
    try {
      const letters = await fetchLetters(config, args.category)
      if (!letters.length) return '信件柜里还没有信'
      const limit = Math.min(args.limit || 20, 60)
      const cat = (c) => (c === 'love' ? '鸾笺' : c === 'penpal' ? '笔友' : c || '?')
      const lines = letters.slice(0, limit).map(l =>
        `id:${l.id} [${cat(l.category)}] ${l.sender || '?'} → ${l.recipient || '?'}${l.title ? `《${l.title}》` : ''}（${(l.sent_at || l.created_at || '').slice(0, 10)}）`
      )
      const more = letters.length > limit ? `\n（共 ${letters.length} 封，只列了前 ${limit} 封，可加 limit 或按 category 筛）` : ''
      return lines.join('\n') + more
    } catch (e) {
      return `读取信件失败: ${e.message}`
    }
  }
  if (toolName === 'read_letter') {
    try {
      const letter = await fetchLetter(config, args.letter_id)
      const annos = await fetchLetterAnnotations(config, args.letter_id).catch(() => [])
      const body = letter.body || ''
      const total = Math.max(1, Math.ceil(body.length / BOOK_PAGE_SIZE))
      const p = Math.min(Math.max(0, args.page || 0), total - 1)
      const text = body.slice(p * BOOK_PAGE_SIZE, (p + 1) * BOOK_PAGE_SIZE)
      const hint = total > 1 && p < total - 1 ? `（还有后文，传 page=${p + 1} 继续读）` : '（信末）'
      const annoBlock = annos.length
        ? `\n\n信上已有 ${annos.length} 条划线批注：\n` + annos.map((a, i) =>
            `${i + 1}. [${a.author}·${a.color}]「${a.quote}」${a.note ? ` — ${a.note}` : ''}`
          ).join('\n')
        : ''
      return `${letter.sender || '?'} → ${letter.recipient || '?'}${letter.title ? `《${letter.title}》` : ''}（${(letter.sent_at || '').slice(0, 10)}）第 ${p + 1}/${total} 页 ${hint}\n\n${text}${annoBlock}`
    } catch (e) {
      return `读信失败: ${e.message}`
    }
  }
  if (toolName === 'annotate_letter') {
    try {
      const quote = String(args.quote || '').trim()
      if (!quote) return '划线失败: quote 不能为空'
      const letter = await fetchLetter(config, args.letter_id)
      const body = letter.body || ''
      // 同 annotate_book：LLM 数不准偏移，用 quote 原文定位
      const occurrence = args.occurrence || 1
      let start = -1
      for (let i = 0; i < occurrence; i++) {
        start = body.indexOf(quote, start + 1)
        if (start === -1) break
      }
      if (start === -1) {
        return `划线失败: 信里找不到第 ${occurrence} 处 quote，请检查是否与正文逐字一致（含标点空格）`
      }
      const anno = await createLetterAnnotation(config, args.letter_id, {
        start_off: start,
        end_off: start + quote.length,
        quote,
        author: '涟言',
        color: args.color || 'blue',
        note: args.note || '',
      })
      return `已在信上划线批注（id:${anno.id}）：「${quote.slice(0, 40)}${quote.length > 40 ? '…' : ''}」${args.note ? ` — ${args.note}` : ''}`
    } catch (e) {
      return `划线失败: ${e.message}`
    }
  }
  if (toolName === 'annotate_book') {
    try {
      const quote = String(args.quote || '').trim()
      if (!quote) return '划线失败: quote 不能为空'
      const ch = await fetchBookChapter(config, args.book_id, args.chapter_idx)
      // LLM 数不准字符偏移，这里用 quote 原文在正文里定位（支持第 N 次出现）
      const occurrence = args.occurrence || 1
      let start = -1
      for (let i = 0; i < occurrence; i++) {
        start = ch.content.indexOf(quote, start + 1)
        if (start === -1) break
      }
      if (start === -1) {
        return `划线失败: 正文中找不到第 ${occurrence} 处 quote，请检查是否与原文逐字一致（含标点空格）`
      }
      const anno = await createBookAnnotation(config, args.book_id, {
        chapter_idx: args.chapter_idx,
        start_off: start,
        end_off: start + quote.length,
        quote,
        author: '涟言',
        color: args.color || 'blue',
        note: args.note || '',
      })
      return `已划线批注（id:${anno.id}）：「${quote.slice(0, 40)}${quote.length > 40 ? '…' : ''}」${args.note ? ` — ${args.note}` : ''}`
    } catch (e) {
      return `划线失败: ${e.message}`
    }
  }
  if (toolName === 'reading_activity') {
    try {
      const hours = Math.min(args.hours || 48, 24 * 30)
      const act = await fetchReadingActivity(config, hours)
      const fmtMin = (s) => (s >= 3600 ? `${(s / 3600).toFixed(1)}小时` : `${Math.max(1, Math.round(s / 60))}分钟`)
      const lines = []
      const annos = act.annotations || []
      lines.push(annos.length
        ? `最近${hours}小时的划线批注（${annos.length}条）：\n` + annos.slice(0, 15).map((a) =>
            `- [${a.author}]《${a.book_title}》第${a.chapter_idx + 1}章「${(a.quote || '').slice(0, 40)}${(a.quote || '').length > 40 ? '…' : ''}」${a.note ? ` — ${a.note}` : ''}`
          ).join('\n')
        : `最近${hours}小时没有新划线`)
      const reading = act.reading || []
      if (reading.length) {
        lines.push('近7天阅读时长：\n' + reading.map((r) => `- ${r.day} ${r.reader}读《${r.book_title}》${fmtMin(r.seconds)}`).join('\n'))
      }
      const bms = act.bookmarks || []
      if (bms.length) {
        lines.push('书签动向：\n' + bms.map((b) => `- 《${b.book_title}》书签在第${b.chapter_idx + 1}章（${b.updated_by || '?'}移动）`).join('\n'))
      }
      return lines.join('\n\n')
    } catch (e) {
      return `读取阅读动态失败: ${e.message}`
    }
  }
  if (toolName === 'period_tracker') {
    try {
      let data
      if (args.action === 'start') {
        data = await logPeriodStart(config, args.date, args.note, '涟言')
      } else if (args.action === 'end') {
        const cur = await fetchPeriod(config)
        // 乱序补记时进行中的未必是最新一条，找任何一条没结束的
        const ongoing = (cur.logs || []).find((l) => !l.end_date) || null
        if (!ongoing) return '没有进行中的记录，不用记结束'
        data = await logPeriodEnd(config, ongoing.id, args.date)
      } else {
        data = await fetchPeriod(config)
      }
      const s = data.stats || {}
      const lines = []
      if (args.action === 'start') lines.push('已记下：这次从 ' + (s.last_start || '今天') + ' 开始')
      if (args.action === 'end') lines.push('已记下结束')
      if (!data.logs?.length) return '还没有任何记录，她第一次记之后才有周期可算'
      lines.push(`今天 ${s.today}，${s.ongoing ? `经期第 ${s.day_of_cycle} 天（进行中）` : `周期第 ${s.day_of_cycle} 天`}`)
      if (s.avg_cycle) lines.push(`平均周期 ${s.avg_cycle} 天${s.avg_duration ? `，平均经期 ${s.avg_duration} 天` : ''}`)
      if (s.predicted_next && !s.ongoing) {
        if (s.delta_days > 0) lines.push(`预计 ${s.predicted_next} 来，已延迟 ${s.delta_days} 天`)
        else if (s.delta_days === 0) lines.push(`预计就是今天（${s.predicted_next}）`)
        else lines.push(`预计下次 ${s.predicted_next}，还有 ${-s.delta_days} 天`)
      }
      const recent = (data.logs || []).slice(0, 4).map((l) => `${l.start_date}${l.end_date ? `~${l.end_date}` : '（进行中）'}`).join('、')
      if (recent) lines.push(`最近记录：${recent}`)
      return lines.join('\n')
    } catch (e) {
      return `周期记录操作失败: ${e.message}`
    }
  }
  if (toolName === 'check_health') {
    try {
      const hours = Math.min(args.hours || 24, 24 * 30)
      const rows = await fetchVitals(config, hours)
      if (!Array.isArray(rows) || !rows.length) return `最近${hours}小时没有健康数据（可能手环没同步或她没戴）`
      const fmt = (r) => {
        const parts = []
        if (r.bpm_avg != null) parts.push(`心率均值${r.bpm_avg}`)
        if (r.bpm_max != null) parts.push(`心率峰值${r.bpm_max}`)
        if (r.steps != null) parts.push(`步数${r.steps}`)
        if (r.calories != null) parts.push(`卡路里${Math.round(r.calories)}千卡`)
        if (r.sleep_ms != null) parts.push(`睡眠${(r.sleep_ms / 3600000).toFixed(1)}小时`)
        return parts.join('，') || '（空）'
      }
      const latest = rows[0]
      const ageMin = Math.round((Date.now() - new Date(latest.created_at.replace(' ', 'T') + 'Z').getTime()) / 60000)
      const lines = [`最新快照（${ageMin < 60 ? `${ageMin}分钟前` : `${(ageMin / 60).toFixed(1)}小时前`}）：${fmt(latest)}`]
      if (rows.length > 1) {
        lines.push(`最近${hours}小时共${rows.length}条记录：`)
        lines.push(rows.slice(0, 12).map((r) => `- ${String(r.created_at).slice(5, 16)} ${fmt(r)}`).join('\n'))
      }
      lines.push('（数据来自她手环，时间为UTC+0，加8小时是北京时间）')
      return lines.join('\n')
    } catch (e) {
      return `读取健康数据失败: ${e.message}`
    }
  }
  if (toolName === 'check_weather') {
    try {
      const w = await fetchWeather(config)
      return formatWeatherLine(w)
    } catch (e) {
      return `看天气失败: ${e.message}`
    }
  }
  if (toolName === 'daily_checklist') {
    try {
      const action = String(args.action || 'list')
      if (action === 'add') {
        const text = String(args.text || '').trim()
        if (!text) return '添加失败: text 不能为空'
        const row = await request(config.baseUrl, '/checklist', {
          method: 'POST', headers: headers(config.apiToken),
          body: JSON.stringify({ text, added_by: '涟言' }),
        })
        return `已记到今日小票（id ${row.id}）：${row.text}`
      }
      if (action === 'done') {
        if (args.id == null) return '划掉失败: 缺 id（先 list 拿 id）'
        const row = await request(config.baseUrl, `/checklist/${args.id}`, {
          method: 'PATCH', headers: headers(config.apiToken),
          body: JSON.stringify({ done: true }),
        })
        return `已划掉：${row.text}`
      }
      const rows = await request(config.baseUrl, '/checklist', { headers: headers(config.apiToken) })
      if (!rows.length) return '今天的小票还是空的'
      const doneCount = rows.filter((r) => r.done).length
      return [
        `今日小票（${rows[0].day}）共 ${rows.length} 项，完成 ${doneCount} 项：`,
        ...rows.map((r) => `- [id ${r.id}] ${r.done ? '✓' : '□'} ${r.text}${r.added_by === '涟言' ? '（我帮她记的）' : ''}`),
      ].join('\n')
    } catch (e) {
      return `清单操作失败: ${e.message}`
    }
  }
  if (toolName === 'send_heart_card') {
    try {
      const message = String(args.message || '').trim()
      if (!message) return '发卡失败: message 不能为空'
      const res = await request(config.baseUrl, '/cards', {
        method: 'POST', headers: headers(config.apiToken),
        body: JSON.stringify({ message, author: '涟言', source: 'api' }),
      })
      // 立刻在她屏幕上弹出（工具跑在浏览器里，直接驱动 UI）
      try {
        window.dispatchEvent(new CustomEvent('yanji:heart-card', { detail: res.card }))
      } catch { /* 非浏览器环境忽略 */ }
      return '心意卡已经弹到她眼前了。不必在回复里复述卡片内容，自然接着聊即可。'
    } catch (e) {
      return `发卡失败: ${e.message}`
    }
  }
  if (toolName === 'read_board_messages') {
    try {
      const limit = Math.min(args.limit || 10, 50)
      const rows = await request(config.baseUrl, `/board?limit=${limit}`, { headers: headers(config.apiToken) })
      if (!rows.length) return '留言板还是空的'
      return rows.map((r) => `[${r.author} ${String(r.created_at || '').slice(0, 10)}] ${r.text}`).join('\n')
    } catch (e) {
      return `读取留言板失败: ${e.message}`
    }
  }
  if (toolName === 'leave_board_message') {
    try {
      const text = String(args.text || '').trim()
      if (!text) return '留言失败: 内容不能为空'
      const row = await request(config.baseUrl, '/board', {
        method: 'POST',
        headers: headers(config.apiToken),
        body: JSON.stringify({ text, author: '涟言', source: 'yanji' }),
      })
      return `已留言（id:${row.id}）：「${row.text}」——阿颖打开留言板就能看到`
    } catch (e) {
      return `留言失败: ${e.message}`
    }
  }
  if (toolName === 'list_conversations') {
    try {
      const SRC = { claude_ai: 'Claude', yanji: '言叽', raven: '归巢', claude_code: 'CC' }
      const limit = Math.min(args.limit || 20, 50)
      const list = await fetchArchiveConversations(config)
      const arr = Array.isArray(list) ? list : []
      if (!arr.length) return '还没有可共读的旧对话'
      return arr.slice(0, limit).map((c) =>
        `id:${c.id}「${c.title || '无题'}」[${SRC[c.source] || c.source || ''}]${(c.created_at || '').slice(0, 10)}`
      ).join('\n')
    } catch (e) { return `读取旧对话列表失败: ${e.message}` }
  }
  if (toolName === 'read_conversation') {
    try {
      const full = await fetchArchiveConversation(config, args.conversation_id)
      const msgs = full.messages || []
      if (!msgs.length) return '这段对话是空的'
      const annoByMsg = {}
      try {
        const annos = await fetchAnnotations(config, args.conversation_id)
        for (const a of (annos || [])) (annoByMsg[a.message_id] = annoByMsg[a.message_id] || []).push(a)
      } catch { /* 批注读不到不影响读正文 */ }
      const PAGE = 25
      const total = Math.max(1, Math.ceil(msgs.length / PAGE))
      const p = Math.min(Math.max(0, args.page || 0), total - 1)
      const who = (r) => (r === 'human' || r === 'user') ? '阿颖' : '涟言'
      const body = msgs.slice(p * PAGE, (p + 1) * PAGE).map((m) => {
        const c = (m.content || '').replace(/\s+/g, ' ').trim()
        const txt = c.length > 140 ? c.slice(0, 140) + '…' : c
        const mark = (annoByMsg[m.id] || []).length ? ` 〔已有${annoByMsg[m.id].length}条批注〕` : ''
        return `msgid:${m.id} [${who(m.role)}]${mark} ${txt}`
      }).join('\n')
      const hint = total > 1 ? `（第 ${p + 1}/${total} 页${p < total - 1 ? `，传 page=${p + 1} 继续读` : '，已到末页'}）` : ''
      return `「${full.title || '无题'}」${hint}\n\n${body}`
    } catch (e) { return `读取旧对话失败: ${e.message}` }
  }
  if (toolName === 'annotate_conversation') {
    try {
      if (!args.conversation_id || !args.message_id) return '批注失败: 需要 conversation_id 和 message_id'
      const anno = await createAnnotation(config, args.conversation_id, {
        message_id: args.message_id, author: '涟言', color: args.color || 'pink', note: (args.note || '').trim(),
      })
      return `已在这条上留下批注（id:${anno.id}）${args.note ? `：${args.note}` : '（高亮）'}——阿颖在共读里翻到就能看到`
    } catch (e) { return `批注失败: ${e.message}` }
  }
  if (toolName === 'browse_moments') {
    try {
      const limit = Math.min(args.limit || 10, 50)
      const month = /^\d{4}-\d{2}$/.test(args.month || '') ? args.month : ''
      const rows = await request(config.baseUrl, `/moments?limit=${limit}${month ? `&month=${month}` : ''}`, { headers: headers(config.apiToken) })
      if (!rows.length) return month ? `${month} 没有动态` : '朋友圈还没有动态'
      return rows.map((p) => {
        const time = String(p.created_at || '').slice(0, 16).replace('T', ' ')
        const tag = (p.source === 'dream' ? '〔梦〕' : '') + (p.image_url ? '〔带图〕' : '')
        const likes = (p.likes || []).length ? ` ♥${p.likes.join('、')}` : ''
        const comments = (p.comments || []).map((c) => `\n    ↳ ${c.author}: ${c.content}`).join('')
        const text = (p.content || '').replace(/\s+/g, ' ').slice(0, 120)
        return `id:${p.id} [${p.author} ${time}]${tag} ${text}${likes}${comments}`
      }).join('\n')
    } catch (e) { return `翻朋友圈失败: ${e.message}` }
  }
  if (toolName === 'comment_moment') {
    try {
      const content = String(args.content || '').trim()
      if (!args.id || !content) return '评论失败: 需要 id 和 content'
      await request(config.baseUrl, `/moments/${args.id}/comments`, {
        method: 'POST', headers: headers(config.apiToken),
        body: JSON.stringify({ author: '涟言', content }),
      })
      return `已在动态 id:${args.id} 下留言：「${content}」——阿颖刷朋友圈就能看到`
    } catch (e) { return `评论失败: ${e.message}` }
  }
  return `未知工具: ${toolName}`
}
