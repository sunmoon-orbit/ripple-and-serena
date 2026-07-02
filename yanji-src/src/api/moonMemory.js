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
  const { baseUrl } = config
  return request(baseUrl, '/health')
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
  return (data.text || '').trim()
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
  return request(baseUrl, '/archive/conversations', { headers: headers(apiToken) })
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

export async function saveBookBookmark(config, bookId, chapterIdx, updatedBy) {
  const { baseUrl, apiToken } = config
  return request(baseUrl, `/books/${bookId}/bookmark`, {
    method: 'PUT', headers: headers(apiToken), body: JSON.stringify({ chapter_idx: chapterIdx, updated_by: updatedBy }),
  })
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
      description: '查看某本书某一章的所有划线批注（阿颖和涟言双方的都有）。想看阿颖划了什么、批注了什么时使用。',
      parameters: {
        type: 'object',
        properties: {
          book_id: { type: 'number', description: '书的 id' },
          chapter_idx: { type: 'number', description: '章节序号，从 0 开始' },
        },
        required: ['book_id', 'chapter_idx'],
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
  ]
}

export async function executeMemoryTool(toolName, args, config) {
  if (!config?.enabled || !config?.apiToken) {
    return '记忆库未配置或未启用'
  }
  if (toolName === 'search_memories') {
    try {
      const limit = Math.min(args.limit || 5, 20)
      // 把多词查询拆成单词分别搜索，结果按 id 去重合并（避免短语匹配漏掉相关记忆）
      const terms = String(args.query || '').trim().split(/\s+/).filter(Boolean)
      const seen = new Set()
      const results = []
      for (const term of terms) {
        const hits = await fetchMemories(config, { q: term, scope: args.scope, limit })
        for (const m of hits) {
          if (!seen.has(m.id)) { seen.add(m.id); results.push(m) }
          if (results.length >= limit) break
        }
        if (results.length >= limit) break
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
  return `未知工具: ${toolName}`
}
