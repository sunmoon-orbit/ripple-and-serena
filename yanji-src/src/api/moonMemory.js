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
  return `未知工具: ${toolName}`
}
