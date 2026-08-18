export const MCP_EXTERNAL_TOOL_LIMIT = 8

const clients = new Map()

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

function signature(server) {
  return JSON.stringify([server?.url || '', server?.authType || 'none', server?.bearerToken || ''])
}

function friendlyMcpError(error) {
  const message = error?.message || String(error)
  if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(message)) {
    return new Error('连接不到 MCP 服务。请检查地址、代理，以及服务端是否允许浏览器跨域（CORS）访问。')
  }
  if (/401|Unauthorized/i.test(message)) return new Error('MCP 身份验证失败，请检查 Bearer 令牌')
  return error instanceof Error ? error : new Error(message)
}

async function getClient(server, { refresh = false } = {}) {
  const id = server?.id
  if (!id) throw new Error('MCP 服务缺少 id')
  const sig = signature(server)
  const cached = clients.get(id)
  if (!refresh && cached?.signature === sig) return cached.client
  if (cached) {
    clients.delete(id)
    cached.client.close().catch(() => {})
  }

  const url = validatedUrl(server.url)
  const token = String(server.bearerToken || '').trim()
  if (server.authType === 'bearer' && !token) throw new Error('请填写 Bearer 令牌')
  // SDK 不进聊天首屏包：只有用户真的测试/调用 MCP 时才下载，免得新功能拖慢原有聊天。
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client')
  const transport = new StreamableHTTPClientTransport(url, {
    ...(server.authType === 'bearer' ? { authProvider: { token: async () => token } } : {}),
    requestInit: { cache: 'no-store' },
  })
  const client = new Client(
    { name: 'yanji', version: '2.0.0' },
    { versionNegotiation: { mode: 'auto', probe: { timeoutMs: 12000 } }, inputRequired: { autoFulfill: false } },
  )
  try {
    await client.connect(transport, { timeout: 15000 })
    clients.set(id, { signature: sig, client })
    return client
  } catch (error) {
    await client.close().catch(() => {})
    throw friendlyMcpError(error)
  }
}

export async function discoverMcpTools(server) {
  try {
    const client = await getClient(server, { refresh: true })
    const result = await client.listTools(undefined, { timeout: 15000, cacheMode: 'refresh' })
    return {
      tools: mergeDiscoveredMcpTools(server.tools, result.tools),
      serverInfo: client.getServerVersion?.() || null,
    }
  } catch (error) {
    throw friendlyMcpError(error)
  }
}

export async function executeMcpTool(wireName, args, servers) {
  const resolved = resolveMcpTool(wireName, servers)
  if (!resolved) throw new Error('找不到对应的 MCP 工具，可能刚刚刷新过工具列表')
  const { server, tool } = resolved
  assertMcpToolAllowed(server, tool)
  try {
    const client = await getClient(server)
    const result = await client.callTool({ name: tool.name, arguments: args || {} }, { timeout: 60000 })
    return normalizeMcpResult(result)
  } catch (error) {
    throw friendlyMcpError(error)
  }
}
