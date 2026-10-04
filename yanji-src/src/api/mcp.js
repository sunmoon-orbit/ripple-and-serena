// 一次随聊天发给模型的外部工具上限。原来是 8，游戏类服务一个就有十几个工具，不够用（1004 她提的）；
// 只算开着的服务，关着的服务里勾选的工具不占名额，所以平时关掉服务就不花 token
export const MCP_EXTERNAL_TOOL_LIMIT = 40

function shortHash(value) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).padStart(7, '0').slice(-7)
}

export function mcpWireName(serverId, toolName) {
  const server = String(serverId || 'server').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'server'
  const slug = String(toolName || 'tool')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36) || 'tool'
  return `mcp_${server}_${slug}_${shortHash(`${serverId}:${toolName}`)}`.slice(0, 64)
}

function normalizeInputSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { type: 'object', properties: {} }
  return schema.type === 'object' ? schema : { ...schema, type: 'object' }
}

export function getEnabledMcpToolDefinitions(servers, limit = MCP_EXTERNAL_TOOL_LIMIT) {
  const definitions = []
  for (const server of Array.isArray(servers) ? servers : []) {
    if (!server?.enabled) continue
    for (const tool of Array.isArray(server.tools) ? server.tools : []) {
      if (!tool?.enabled || !tool?.name) continue
      const access = tool.annotations?.readOnlyHint === true ? '只读' : '可能修改外部状态'
      definitions.push({
        name: mcpWireName(server.id, tool.name),
        description: `[MCP · ${server.name || '未命名服务'} · ${access}] ${tool.description || tool.name}`.slice(0, 1000),
        parameters: normalizeInputSchema(tool.inputSchema),
      })
      if (definitions.length >= limit) return definitions
    }
  }
  return definitions
}

// ─── 外部工具索引（1004，参考 cedarstar 的 clio 工具索引教程）────────────────
// 以前开着的 MCP 工具每轮都把整份 schema 发给模型，游戏服务一开就是几千 token，她只好平时关着。
// 现在只发两个固定工具：ext_tool_info 的描述里是一行一行的索引，要用时先拿完整参数，再用 ext_tool_call 执行。
// 好处之一是工具列表每轮不变，提示缓存不会因为开关工具而断。
export const EXT_TOOL_INFO = 'ext_tool_info'
export const EXT_TOOL_CALL = 'ext_tool_call'

function enabledMcpEntries(servers, limit = MCP_EXTERNAL_TOOL_LIMIT) {
  const out = []
  for (const server of Array.isArray(servers) ? servers : []) {
    if (!server?.enabled) continue
    for (const tool of Array.isArray(server.tools) ? server.tools : []) {
      if (!tool?.enabled || !tool?.name) continue
      out.push({ server, tool })
      if (out.length >= limit) return out
    }
  }
  return out
}

function firstSentence(text, max = 80) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  const m = t.match(/^.*?(?:[。！？]|[.!?](?=\s|$))/)
  const cut = m ? m[0] : t
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut
}

export function mcpIndexLine({ server, tool }) {
  const access = tool.annotations?.readOnlyHint === true ? '只读' : '可写'
  const required = Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : []
  const need = required.length ? `；必填 ${required.join('、')}` : ''
  return `- ${tool.name}（${server.name || '未命名服务'}·${access}）${firstSentence(tool.description) ? `：${firstSentence(tool.description)}` : ''}${need}`
}

export function getMcpIndexToolDefinitions(servers) {
  const entries = enabledMcpEntries(servers)
  if (!entries.length) return []
  const index = entries.map(mcpIndexLine).join('\n')
  return [
    {
      name: EXT_TOOL_INFO,
      description: `外部 MCP 工具目录（只列名字和用途，参数要现查）。要用其中某个工具时，先用这个工具查它的完整参数，再用 ${EXT_TOOL_CALL} 执行；参数已经清楚的可以直接执行。\n${index}`,
      parameters: {
        type: 'object',
        properties: {
          tool: { type: 'string', description: '目录里的工具名' },
          server: { type: 'string', description: '服务名；只有两个服务里有同名工具时才需要' },
        },
        required: ['tool'],
      },
    },
    {
      name: EXT_TOOL_CALL,
      description: `执行 ${EXT_TOOL_INFO} 目录里的一个外部 MCP 工具。`,
      parameters: {
        type: 'object',
        properties: {
          tool: { type: 'string', description: '目录里的工具名' },
          server: { type: 'string', description: '服务名；只有同名工具时才需要' },
          arguments: { type: 'object', description: '按完整参数说明填写' },
        },
        required: ['tool'],
      },
    },
  ]
}

export function resolveMcpIndexTool(toolName, serverName, servers) {
  const name = String(toolName || '').trim()
  const hits = enabledMcpEntries(servers).filter(({ server, tool }) =>
    (tool.name === name || mcpWireName(server.id, tool.name) === name) &&
    (!serverName || server.name === serverName || server.id === serverName))
  if (!hits.length) throw new Error(`目录里没有「${name}」，可能没勾选或服务关着。请只用 ${EXT_TOOL_INFO} 目录里列出的工具`)
  if (hits.length > 1) throw new Error(`有多个服务都有「${name}」：${hits.map((h) => h.server.name).join('、')}，请带上 server`)
  return hits[0]
}

export function describeMcpIndexTool(toolName, serverName, servers) {
  const { server, tool } = resolveMcpIndexTool(toolName, serverName, servers)
  const writable = tool.annotations?.readOnlyHint !== true
  return JSON.stringify({
    tool: tool.name,
    server: server.name,
    access: writable ? (server.allowWrites ? '可写（已允许）' : '可写（这个服务没开写权限，执行会被拒）') : '只读',
    description: tool.description || '',
    parameters: normalizeInputSchema(tool.inputSchema),
  })
}

export async function callMcpIndexTool(args, servers, backendConfig) {
  const { server, tool } = resolveMcpIndexTool(args?.tool, args?.server, servers)
  try {
    return await executeMcpTool(mcpWireName(server.id, tool.name), args?.arguments || {}, servers, backendConfig)
  } catch (error) {
    throw new Error(`${error.message}。如果是参数不对，先用 ${EXT_TOOL_INFO} 查「${tool.name}」的完整参数再试`)
  }
}

export function mergeDiscoveredMcpTools(existingTools, discoveredTools) {
  const enabledByName = new Map((existingTools || []).map((tool) => [tool.name, tool.enabled === true]))
  return (discoveredTools || []).filter((tool) => tool?.name).map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    inputSchema: normalizeInputSchema(tool.inputSchema),
    annotations: tool.annotations || {},
    enabled: enabledByName.get(tool.name) || false,
  }))
}

export function resolveMcpTool(wireName, servers) {
  for (const server of Array.isArray(servers) ? servers : []) {
    for (const tool of Array.isArray(server?.tools) ? server.tools : []) {
      if (mcpWireName(server.id, tool.name) === wireName) return { server, tool }
    }
  }
  return null
}

export function assertMcpToolAllowed(server, tool) {
  if (!server?.enabled || !tool?.enabled) throw new Error('这个 MCP 工具已经关闭')
  if (tool.annotations?.readOnlyHint !== true && !server.allowWrites) {
    throw new Error(`工具「${tool.name}」可能修改外部状态；请先在“设置 → 工具与 MCP”中允许这个服务执行写操作`)
  }
}

export function normalizeMcpResult(result) {
  const parts = []
  for (const block of Array.isArray(result?.content) ? result.content : []) {
    if (block?.type === 'text') parts.push(block.text || '')
    else if (block?.type === 'resource' && block.resource?.text) parts.push(block.resource.text)
    else if (block?.type === 'resource_link') parts.push(`[资源链接] ${block.name || ''} ${block.uri || ''}`.trim())
    else if (block?.type === 'image') parts.push(`[图片结果：${block.mimeType || 'image'}，言叽当前只把文字结果交回模型]`)
    else if (block?.type === 'audio') parts.push(`[音频结果：${block.mimeType || 'audio'}，言叽当前只把文字结果交回模型]`)
    else if (block) parts.push(JSON.stringify(block))
  }
  if (result?.structuredContent != null) parts.push(JSON.stringify(result.structuredContent))
  const text = parts.filter(Boolean).join('\n').trim() || '工具执行完成，但没有返回文字内容。'
  return result?.isError ? `MCP 工具返回错误：${text}` : text
}

function validatedUrl(raw) {
  let url
  try { url = new URL(String(raw || '').trim()) } catch { throw new Error('MCP URL 格式不正确') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('远程 MCP 必须使用 HTTPS（本机 localhost 可使用 HTTP）')
  }
  if (url.username || url.password) throw new Error('请不要把账号或令牌写进 URL')
  return url
}

function backendBase(config) {
  if (!config?.apiToken) throw new Error('远程 MCP 需要先在「拾羽」中配置 API Token，用它保护后端凭据')
  let origin
  try { origin = new URL(config.baseUrl || 'https://memory.ravenlove.cc').origin } catch { throw new Error('拾羽地址格式不正确') }
  return `${origin}/raven/yanji-mcp`
}

function friendlyMcpError(error) {
  const message = error?.message || String(error)
  if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(message)) {
    return new Error('连接不到 MCP 服务。请检查地址、代理，以及服务端是否允许浏览器跨域（CORS）访问。')
  }
  if (/401|Unauthorized/i.test(message)) return new Error('MCP 身份验证失败，请重新授权或更新凭据')
  return error instanceof Error ? error : new Error(message)
}

async function backendRequest(config, path, options = {}) {
  const response = await fetch(`${backendBase(config)}${path}`, {
    cache: 'no-store',
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `MCP 后端暂时不可用 (${response.status})`)
  return data
}

function serverPayload(server) {
  validatedUrl(server.url)
  return {
    name: server.name || '', url: server.url, authType: server.authType || 'none',
    credentialMode: server.credentialMode || 'bearer', enabled: server.enabled !== false,
    allowWrites: !!server.allowWrites, oauthClientId: server.oauthClientId || '',
    tools: server.tools || [],
    ...(server.bearerToken ? { bearerToken: server.bearerToken } : {}),
    ...(server.credential ? { credential: server.credential } : {}),
  }
}

export async function syncMcpServer(server, backendConfig) {
  if (!server?.id) throw new Error('MCP 服务缺少 id')
  const data = await backendRequest(backendConfig, `/servers/${encodeURIComponent(server.id)}`, {
    method: 'PUT', body: JSON.stringify(serverPayload(server)),
  })
  if ((server.bearerToken || server.credential) && data.server?.credentialStored) {
    window.dispatchEvent(new CustomEvent('yanji-mcp-credential-stored', { detail: { serverId: server.id } }))
  }
  return data.server
}

export async function deleteMcpServerRemote(serverId, backendConfig) {
  return backendRequest(backendConfig, `/servers/${encodeURIComponent(serverId)}`, { method: 'DELETE' })
}

export async function discoverMcpTools(server, backendConfig) {
  try {
    await syncMcpServer(server, backendConfig)
    const data = await backendRequest(backendConfig, `/servers/${encodeURIComponent(server.id)}/discover`, { method: 'POST' })
    return {
      tools: mergeDiscoveredMcpTools(server.tools, data.server?.tools || []),
      serverInfo: data.server?.serverInfo || null,
      server: data.server,
    }
  } catch (error) {
    throw friendlyMcpError(error)
  }
}

export async function executeMcpTool(wireName, args, servers, backendConfig) {
  const resolved = resolveMcpTool(wireName, servers)
  if (!resolved) throw new Error('找不到对应的 MCP 工具，可能刚刚刷新过工具列表')
  const { server, tool } = resolved
  assertMcpToolAllowed(server, tool)
  try {
    await syncMcpServer(server, backendConfig)
    const data = await backendRequest(backendConfig, `/servers/${encodeURIComponent(server.id)}/call`, {
      method: 'POST', body: JSON.stringify({ name: tool.name, arguments: args || {} }),
    })
    return normalizeMcpResult(data.result)
  } catch (error) {
    throw friendlyMcpError(error)
  }
}

export async function startMcpOAuth(server, backendConfig) {
  await syncMcpServer(server, backendConfig)
  return backendRequest(backendConfig, `/servers/${encodeURIComponent(server.id)}/oauth/start`, { method: 'POST' })
}

export async function revokeMcpOAuth(serverId, backendConfig) {
  return backendRequest(backendConfig, `/servers/${encodeURIComponent(serverId)}/oauth/revoke`, { method: 'POST' })
}

export async function pollMcpDeviceOAuth(serverId, backendConfig) {
  return backendRequest(backendConfig, `/servers/${encodeURIComponent(serverId)}/oauth/device/poll`, { method: 'POST' })
}

export async function getMcpServerStatus(serverId, backendConfig) {
  const data = await backendRequest(backendConfig, `/servers/${encodeURIComponent(serverId)}`)
  return data.server
}

export async function getAndcoWakeStatus(backendConfig) {
  return backendRequest(backendConfig, '/wake/status')
}

export async function saveAndcoWakeConfig(config, backendConfig) {
  return backendRequest(backendConfig, '/wake/config', { method: 'PUT', body: JSON.stringify(config) })
}

export async function getAndcoWakePending(backendConfig) {
  return backendRequest(backendConfig, '/wake/pending')
}

export async function acknowledgeAndcoWake(deliveryId, backendConfig) {
  return backendRequest(backendConfig, '/wake/ack', { method: 'POST', body: JSON.stringify({ deliveryId }) })
}
