// Unified LLM streaming API — OpenAI / Gemini / Anthropic
import { getMemoryToolDefinitions, executeMemoryTool } from './moonMemory'

export function normalizeProvider(raw) {
  const v = (raw || '').toString().toLowerCase()
  if (v.includes('gemini')) return 'gemini'
  if (v.includes('anthropic') || v.includes('claude')) return 'anthropic'
  return 'openai'
}

function buildApiUrl(baseUrl, provider) {
  let url = (baseUrl || '').trim().replace(/\/$/, '')
  if (provider === 'openai') {
    if (url.includes('/chat/completions')) return url
    if (!url) url = 'https://api.openai.com/v1'
    if (!url.includes('/v1')) url += '/v1'
    return url + '/chat/completions'
  }
  if (provider === 'anthropic') {
    if (url.includes('/messages')) return url
    if (!url) url = 'https://api.anthropic.com/v1'
    if (!url.includes('/v1')) url += '/v1'
    return url + '/messages'
  }
  return url
}

function geminiApiVersion(model) {
  const m = (model || '').toLowerCase()
  if (m.includes('2.0') || m.includes('2.5') || m.includes('exp') || m.includes('preview')) return 'v1beta'
  if (m.includes('1.5') || m.includes('1.0')) return 'v1'
  return 'v1beta'
}

export function checkToolSupport(provider, model) {
  const m = (model || '').toLowerCase()
  if (m.includes('deepseek-reasoner')) return false
  if (provider === 'openai') return true
  if (provider === 'gemini') return m.includes('1.5') || m.includes('2.0') || m.includes('2.5') || m.includes('flash') || m.includes('pro')
  if (provider === 'anthropic') return m.includes('claude-3') || m.includes('claude-sonnet') || m.includes('claude-opus')
  return false
}

// ─── Tool definitions registry ─────────────────────────────────────────────

function getAllTools(searchConfig, moonMemoryConfig) {
  const tools = []
  if (searchConfig?.apiKey) {
    tools.push({
      name: 'web_search',
      description: '搜索互联网获取最新信息。当用户询问新闻、时事、最新数据或实时信息时使用。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] },
    })
  }
  if (moonMemoryConfig?.enabled && moonMemoryConfig?.apiToken) {
    tools.push(...getMemoryToolDefinitions())
  }
  return tools
}

function formatToolsForProvider(tools, provider) {
  if (provider === 'openai') {
    return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
  }
  if (provider === 'gemini') {
    return [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }]
  }
  if (provider === 'anthropic') {
    return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
  }
  return []
}

async function executeTool(name, args, { searchConfig, moonMemoryConfig, onStatus }) {
  if (name === 'web_search') {
    onStatus?.('搜索中...')
    try {
      return await performWebSearch(args.query, searchConfig)
    } catch (e) {
      return `搜索失败: ${e.message}`
    }
  }
  if (name === 'search_memories' || name === 'write_memory') {
    onStatus?.(name === 'write_memory' ? '写入记忆...' : '检索记忆...')
    return await executeMemoryTool(name, args, moonMemoryConfig)
  }
  return `未知工具: ${name}`
}

async function performWebSearch(query, config) {
  const { provider, apiKey } = config || {}
  if (provider === 'tavily' || (!provider && apiKey?.startsWith('tvly'))) {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query, max_results: 5, include_answer: true }),
    })
    if (!resp.ok) throw new Error('Tavily ' + resp.status)
    const data = await resp.json()
    const results = (data.results || []).map((r, i) => `${i + 1}. ${r.title}\n${r.content}\n${r.url}`)
    if (data.answer) results.unshift(`综合回答: ${data.answer}`)
    return results.join('\n\n')
  }
  // Default: Serper
  const resp = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: query, num: 5, hl: 'zh-CN' }),
  })
  if (!resp.ok) throw new Error('Serper ' + resp.status)
  const data = await resp.json()
  return (data.organic || []).map((r, i) => `${i + 1}. ${r.title}\n${r.snippet}\n${r.link}`).join('\n\n')
}

// ─── Build system prompt ────────────────────────────────────────────────────

export function buildSystemPrompt(globalInstruction, memoryItems, moonContext) {
  let parts = []
  if (globalInstruction?.trim()) parts.push(globalInstruction.trim())
  const enabled = (memoryItems || []).filter((m) => m.enabled !== false)
  if (enabled.length) {
    parts.push('【记忆】\n' + enabled.map((m) => '- ' + m.content).join('\n'))
  }
  if (moonContext?.trim()) parts.push(moonContext.trim())
  return parts.join('\n\n')
}

// ─── Main send function ─────────────────────────────────────────────────────

export async function sendMessage({
  connection,
  messages,
  systemPrompt,
  model,
  generationConfig,
  searchConfig,
  moonMemoryConfig,
  autoTools,
  onChunk,
  onThinking,
  onStatus,
  onToolCall,
}) {
  if (!connection) throw new Error('未选择连接')
  const provider = normalizeProvider(connection.provider)
  const usedModel = model || connection.defaultModel
  if (!usedModel) throw new Error('未设置模型')

  const tools = autoTools !== false ? getAllTools(searchConfig, moonMemoryConfig) : []
  const hasTools = tools.length > 0 && checkToolSupport(provider, usedModel)

  if (hasTools) {
    return await callWithTools({
      connection, messages, systemPrompt, model: usedModel, generationConfig,
      tools, provider, searchConfig, moonMemoryConfig, onChunk, onThinking, onStatus, onToolCall,
    })
  }
  return await callStream({
    connection, messages, systemPrompt, model: usedModel, generationConfig, provider, onChunk, onThinking,
  })
}

// ─── Tool-use loop (non-streaming, supports multi-turn) ─────────────────────

async function callWithTools({
  connection, messages, systemPrompt, model, generationConfig,
  tools, provider, searchConfig, moonMemoryConfig, onChunk, onThinking, onStatus, onToolCall,
}) {
  const { temperature = 0.7, maxTokens = 4096 } = generationConfig || {}
  const safeTemp = provider === 'anthropic' ? Math.min(temperature, 1) : Math.min(temperature, 2)
  const formattedTools = formatToolsForProvider(tools, provider)
  let convo = [...messages]
  let finalText = ''
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  for (let iter = 0; iter < 6; iter++) {
    onStatus?.(iter === 0 ? '思考中...' : '继续思考...')

    // ── OpenAI ──────────────────────────────────────────────────────
    if (provider === 'openai') {
      const url = buildApiUrl(connection.baseUrl, 'openai')
      const bodyMsgs = buildOpenAIMessages(convo, systemPrompt)
      const body = { model, messages: bodyMsgs, temperature: safeTemp, max_tokens: maxTokens, tools: formattedTools, tool_choice: 'auto' }
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + connection.apiKey },
        body: JSON.stringify(body),
      })
      if (!resp.ok) throw new Error('OpenAI ' + resp.status + ': ' + (await resp.text()).slice(0, 200))
      const data = await resp.json()
      if (data.usage) accUsage(usage, { p: data.usage.prompt_tokens, c: data.usage.completion_tokens })
      const msg = data.choices[0].message
      if (msg.tool_calls?.length) {
        onToolCall?.(msg.tool_calls.map((t) => t.function.name))
        convo.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls })
        for (const tc of msg.tool_calls) {
          const args = JSON.parse(tc.function.arguments || '{}')
          const result = await executeTool(tc.function.name, args, { searchConfig, moonMemoryConfig, onStatus })
          convo.push({ role: 'tool', tool_call_id: tc.id, content: result })
        }
        continue
      }
      finalText = msg.content || ''
      break
    }

    // ── Anthropic ────────────────────────────────────────────────────
    if (provider === 'anthropic') {
      const url = buildApiUrl(connection.baseUrl, 'anthropic')
      const bodyMsgs = buildAnthropicMessages(convo)
      const body = { model, max_tokens: maxTokens, messages: bodyMsgs, tools: formattedTools }
      if (systemPrompt?.trim()) {
        body.system = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
      }
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': connection.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      })
      if (!resp.ok) throw new Error('Anthropic ' + resp.status + ': ' + (await resp.text()).slice(0, 200))
      const data = await resp.json()
      if (data.usage) accUsage(usage, { p: data.usage.input_tokens, c: data.usage.output_tokens })
      const toolBlock = data.content?.find((b) => b.type === 'tool_use')
      if (toolBlock) {
        onToolCall?.([toolBlock.name])
        convo.push({ role: 'assistant', content: data.content })
        const result = await executeTool(toolBlock.name, toolBlock.input || {}, { searchConfig, moonMemoryConfig, onStatus })
        convo.push({ role: 'user', tool_use_id: toolBlock.id, content: result })
        continue
      }
      finalText = data.content?.filter((b) => b.type === 'text').map((b) => b.text).join('') || ''
      break
    }

    // ── Gemini ───────────────────────────────────────────────────────
    if (provider === 'gemini') {
      const apiVer = geminiApiVersion(model)
      let base = connection.baseUrl || `https://generativelanguage.googleapis.com/${apiVer}`
      if (!base.includes('/v1')) base = base.replace(/\/$/, '') + '/' + apiVer
      base = base.replace(/\/$/, '')
      const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${connection.apiKey}`
      const contents = buildGeminiContents(convo, systemPrompt)
      const body = {
        contents,
        tools: formattedTools,
        generationConfig: { temperature: safeTemp, maxOutputTokens: maxTokens },
        safetySettings: geminiSafetyOff(),
      }
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!resp.ok) throw new Error('Gemini ' + resp.status + ': ' + (await resp.text()).slice(0, 200))
      const data = await resp.json()
      const parts = data.candidates?.[0]?.content?.parts || []
      const fcPart = parts.find((p) => p.functionCall)
      if (fcPart) {
        const fc = fcPart.functionCall
        onToolCall?.([fc.name])
        convo.push({ role: 'assistant', content: '', functionCall: fc })
        const result = await executeTool(fc.name, fc.args || {}, { searchConfig, moonMemoryConfig, onStatus })
        convo.push({ role: 'function', content: result, functionResponse: { name: fc.name, response: { result } } })
        continue
      }
      finalText = parts.filter((p) => p.text).map((p) => p.text).join('')
      break
    }

    break
  }

  onChunk?.(finalText)
  return { text: finalText, usage }
}

// ─── Streaming (no tools) ───────────────────────────────────────────────────

async function callStream({ connection, messages, systemPrompt, model, generationConfig, provider, onChunk, onThinking }) {
  const { temperature = 0.7, maxTokens = 4096 } = generationConfig || {}
  const safeTemp = provider === 'anthropic' ? Math.min(temperature, 1) : Math.min(temperature, 2)

  if (provider === 'openai') {
    const url = buildApiUrl(connection.baseUrl, 'openai')
    const bodyMsgs = buildOpenAIMessages(messages, systemPrompt)
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + connection.apiKey },
      body: JSON.stringify({ model, messages: bodyMsgs, temperature: safeTemp, max_tokens: maxTokens, stream: true }),
    })
    if (!resp.ok) {
      const e = await resp.text()
      const hint = resp.status === 405 ? '（检查 Base URL 是否含 /v1）' : resp.status === 403 ? '（API Key 无效）' : ''
      throw new Error(`OpenAI ${resp.status}${hint}: ${e.slice(0, 200)}`)
    }
    return streamSSE(resp, (line) => {
      const json = JSON.parse(line)
      // DeepSeek reasoning_content
      const thinking = json.choices?.[0]?.delta?.reasoning_content
      if (thinking) { onThinking?.(thinking); return null }
      return json.choices?.[0]?.delta?.content || null
    }, onChunk)
  }

  if (provider === 'anthropic') {
    const url = buildApiUrl(connection.baseUrl, 'anthropic')
    const bodyMsgs = buildAnthropicMessages(messages)
    const isThinkingModel = (model || '').includes('3-7') || (model || '').includes('4')
    const body = { model, max_tokens: maxTokens, messages: bodyMsgs, stream: true }
    if (systemPrompt?.trim()) {
      body.system = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
    }
    if (isThinkingModel && onThinking) {
      body.thinking = { type: 'enabled', budget_tokens: Math.min(maxTokens, 8000) }
      body.temperature = 1  // Anthropic extended thinking requires temp=1
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': connection.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    })
    if (!resp.ok) throw new Error('Anthropic ' + resp.status + ': ' + (await resp.text()).slice(0, 200))
    return streamSSE(resp, (line) => {
      const json = JSON.parse(line)
      if (json.type === 'content_block_delta') {
        if (json.delta?.type === 'thinking_delta') { onThinking?.(json.delta.thinking); return null }
        if (json.delta?.type === 'text_delta') return json.delta.text
      }
      return null
    }, onChunk)
  }

  if (provider === 'gemini') {
    const apiVer = geminiApiVersion(model)
    let base = connection.baseUrl || `https://generativelanguage.googleapis.com/${apiVer}`
    if (!base.includes('/v1')) base = base.replace(/\/$/, '') + '/' + apiVer
    base = base.replace(/\/$/, '')
    const url = `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${connection.apiKey}`
    const contents = buildGeminiContents(messages, systemPrompt)
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig: { temperature: safeTemp, maxOutputTokens: maxTokens }, safetySettings: geminiSafetyOff() }),
    })
    if (!resp.ok) throw new Error('Gemini ' + resp.status + ': ' + (await resp.text()).slice(0, 200))
    return streamSSE(resp, (line) => {
      const json = JSON.parse(line)
      return json.candidates?.[0]?.content?.parts?.[0]?.text || null
    }, onChunk)
  }

  throw new Error('不支持的 provider: ' + provider)
}

async function streamSSE(resp, parseLine, onChunk) {
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let usage = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') continue
      try {
        const text = parseLine(data)
        if (text) {
          fullText += text
          onChunk?.(text)
        }
      } catch {}
    }
  }
  return { text: fullText, usage }
}

// ─── Message format helpers ─────────────────────────────────────────────────

function buildOpenAIMessages(messages, systemPrompt) {
  const out = []
  if (systemPrompt?.trim()) out.push({ role: 'system', content: systemPrompt })
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content })
    } else if (m.role === 'assistant' && m.tool_calls) {
      out.push({ role: 'assistant', content: m.content || null, tool_calls: m.tool_calls })
    } else if (m.images?.length) {
      const parts = [{ type: 'text', text: m.content || '' }]
      for (const img of m.images) parts.push({ type: 'image_url', image_url: { url: img } })
      out.push({ role: m.role, content: parts })
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  return out
}

function buildAnthropicMessages(messages) {
  return messages.map((m) => {
    if (m.tool_use_id) {
      return { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_use_id, content: m.content }] }
    }
    if (Array.isArray(m.content)) return { role: m.role, content: m.content }
    if (m.images?.length) {
      const parts = []
      for (const img of m.images) {
        const match = img.match(/^data:(.+);base64,(.+)$/)
        if (match) parts.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } })
      }
      parts.push({ type: 'text', text: m.content || '' })
      return { role: m.role, content: parts }
    }
    return { role: m.role, content: m.content }
  })
}

function buildGeminiContents(messages, systemPrompt) {
  const out = []
  if (systemPrompt?.trim()) {
    out.push({ role: 'user', parts: [{ text: '[系统指令]\n' + systemPrompt }] })
    out.push({ role: 'model', parts: [{ text: '好的，我会遵循这些指令。' }] })
  }
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user'
    if (m.functionResponse) {
      out.push({ role: 'function', parts: [{ functionResponse: m.functionResponse }] })
    } else if (m.functionCall) {
      out.push({ role: 'model', parts: [{ functionCall: m.functionCall }] })
    } else if (m.images?.length) {
      const parts = []
      for (const img of m.images) {
        const match = img.match(/^data:(.+);base64,(.+)$/)
        if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } })
      }
      parts.push({ text: m.content || '' })
      out.push({ role, parts })
    } else {
      out.push({ role, parts: [{ text: m.content }] })
    }
  }
  return out
}

function geminiSafetyOff() {
  return [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
  ]
}

function accUsage(total, { p, c }) {
  total.promptTokens += p || 0
  total.completionTokens += c || 0
  total.totalTokens += (p || 0) + (c || 0)
}

export const BUILTIN_MODELS = {
  openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o1'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.5-flash-preview-04-17'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
}
