import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MCP_EXTERNAL_TOOL_LIMIT,
  assertMcpToolAllowed,
  getEnabledMcpToolDefinitions,
  mcpWireName,
  mergeDiscoveredMcpTools,
  normalizeMcpResult,
  resolveMcpTool,
} from '../src/api/mcp.js'

test('MCP wire names are stable, provider-safe and at most 64 chars', () => {
  const first = mcpWireName('server-123456789', '一条很长的工具名 / send something with spaces '.repeat(3))
  const second = mcpWireName('server-123456789', '一条很长的工具名 / send something with spaces '.repeat(3))
  assert.equal(first, second)
  assert.match(first, /^[a-zA-Z0-9_-]+$/)
  assert.ok(first.length <= 64)
})

test('only enabled MCP servers and tools are exposed, capped at eight', () => {
  const tools = Array.from({ length: 12 }, (_, i) => ({ name: `tool_${i}`, enabled: true, inputSchema: { type: 'object' } }))
  const definitions = getEnabledMcpToolDefinitions([
    { id: 'off', name: 'off', enabled: false, tools },
    { id: 'on', name: 'on', enabled: true, tools },
  ])
  assert.equal(definitions.length, MCP_EXTERNAL_TOOL_LIMIT)
  assert.ok(definitions.every((tool) => tool.description.includes('[MCP · on')))
})

test('discovery refresh preserves enabled choices by original tool name', () => {
  const merged = mergeDiscoveredMcpTools(
    [{ name: 'read', enabled: true }, { name: 'gone', enabled: true }],
    [{ name: 'read', description: 'new' }, { name: 'write' }],
  )
  assert.deepEqual(merged.map(({ name, enabled }) => ({ name, enabled })), [
    { name: 'read', enabled: true },
    { name: 'write', enabled: false },
  ])
})

test('unknown or writable tools require explicit server write permission', () => {
  const server = { enabled: true, allowWrites: false }
  assert.doesNotThrow(() => assertMcpToolAllowed(server, { name: 'read', enabled: true, annotations: { readOnlyHint: true } }))
  assert.throws(() => assertMcpToolAllowed(server, { name: 'write', enabled: true, annotations: {} }), /允许这个服务执行写操作/)
  assert.doesNotThrow(() => assertMcpToolAllowed({ ...server, allowWrites: true }, { name: 'write', enabled: true }))
})

test('wire names resolve back to the selected server tool', () => {
  const server = { id: 'abc', enabled: true, tools: [{ name: 'fish', enabled: true }] }
  assert.deepEqual(resolveMcpTool(mcpWireName('abc', 'fish'), [server]), { server, tool: server.tools[0] })
})

test('MCP results combine text and structured output without binary blobs', () => {
  const text = normalizeMcpResult({
    content: [{ type: 'text', text: 'done' }, { type: 'image', mimeType: 'image/png', data: 'huge' }],
    structuredContent: { score: 3 },
  })
  assert.match(text, /done/)
  assert.match(text, /图片结果/)
  assert.match(text, /"score":3/)
  assert.doesNotMatch(text, /huge/)
})
