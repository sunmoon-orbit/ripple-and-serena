const dns = require('dns').promises
const net = require('net')

function isPrivateAddress(address) {
  if (!net.isIP(address)) return true
  if (net.isIPv4(address)) {
    const p = address.split('.').map(Number)
    return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) || (p[0] >= 224)
  }
  const value = address.toLowerCase()
  return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')
}

async function assertPublicEndpoint(raw, { allowLocal = process.env.NODE_ENV === 'test', lookup = dns.lookup } = {}) {
  let url
  try { url = new URL(String(raw || '')) } catch { throw new Error('MCP URL 格式不正确') }
  if (url.username || url.password || url.hash) throw new Error('MCP URL 含有不安全字段')
  if (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:')) throw new Error('远程 MCP 必须使用 HTTPS')
  if (!allowLocal) {
    const records = await lookup(url.hostname, { all: true, verbatim: true })
    if (!records.length || records.some((item) => isPrivateAddress(item.address))) throw new Error('MCP 地址不能指向本机或内网')
  }
  return url
}

function parseSse(text) {
  const messages = []
  for (const block of String(text || '').split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) continue
    try { messages.push(JSON.parse(data)) } catch { /* ignore comments and malformed frames */ }
  }
  return messages
}

async function readLimitedText(response, limit = 2 * 1024 * 1024) {
  if (!response.body?.getReader) {
    const text = await response.text()
    if (Buffer.byteLength(text) > limit) throw new Error('MCP 响应过大')
    return text
  }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { await reader.cancel().catch(() => {}); throw new Error('MCP 响应过大') }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function rpcRequest({ url, payload, authHeaders, sessionId, fetchImpl = fetch, timeoutMs = 15000 }) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-11-25',
    ...authHeaders,
  }
  if (sessionId) headers['MCP-Session-Id'] = sessionId
  const response = await fetchImpl(url, {
    method: 'POST', redirect: 'error', headers, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (response.status === 401) {
    const error = new Error('MCP 身份验证失败')
    error.status = 401
    throw error
  }
  if (!response.ok && response.status !== 202) throw new Error(`MCP 服务暂时不可用 (${response.status})`)
  const nextSession = response.headers.get('mcp-session-id') || sessionId || ''
  if (response.status === 202 || payload.id == null) return { result: null, sessionId: nextSession }
  const raw = await readLimitedText(response)
  let messages = []
  if (/text\/event-stream/i.test(response.headers.get('content-type') || '')) messages = parseSse(raw)
  else {
    try { messages = [JSON.parse(raw)] } catch { throw new Error('MCP 返回了无法识别的响应') }
  }
  const message = messages.find((item) => item && item.id === payload.id) || messages.find((item) => item?.error || item?.result)
  if (!message) throw new Error('MCP 没有返回请求结果')
  // 对端错误文本不可信，可能回显请求头或授权详情；前端只拿固定短消息。
  if (message.error) throw new Error('MCP 请求失败')
  return { result: message.result, sessionId: nextSession }
}

async function withMcpSession(server, authHeaders, operation, options = {}) {
  const endpoint = await assertPublicEndpoint(server.url, options)
  const url = endpoint.href
  let sessionId = ''
  const init = await rpcRequest({
    url, authHeaders, fetchImpl: options.fetchImpl,
    payload: {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'yanji', version: '2.0.0' } },
    },
  })
  sessionId = init.sessionId
  await rpcRequest({
    url, authHeaders, sessionId, fetchImpl: options.fetchImpl,
    payload: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
  })
  try {
    return await operation({ url, sessionId, fetchImpl: options.fetchImpl, authHeaders })
  } finally {
    if (sessionId) {
      const headers = { 'MCP-Session-Id': sessionId, 'MCP-Protocol-Version': '2025-11-25', ...authHeaders }
      options.fetchImpl?.(url, { method: 'DELETE', redirect: 'error', headers, signal: AbortSignal.timeout(5000) }).catch(() => {})
        || fetch(url, { method: 'DELETE', redirect: 'error', headers, signal: AbortSignal.timeout(5000) }).catch(() => {})
    }
  }
}

async function listTools(server, authHeaders, options = {}) {
  return withMcpSession(server, authHeaders, async (session) => {
    const response = await rpcRequest({ ...session, payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } })
    return { tools: Array.isArray(response.result?.tools) ? response.result.tools : [], serverInfo: null }
  }, options)
}

async function callTool(server, authHeaders, name, args, options = {}) {
  return withMcpSession(server, authHeaders, async (session) => {
    const response = await rpcRequest({
      ...session, timeoutMs: 60000,
      payload: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args || {} } },
    })
    return response.result
  }, options)
}

module.exports = { assertPublicEndpoint, callTool, isPrivateAddress, listTools, parseSse, readLimitedText, rpcRequest }
