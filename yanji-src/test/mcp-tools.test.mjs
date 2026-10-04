import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MCP_EXTERNAL_TOOL_LIMIT,
  EXT_TOOL_CALL,
  EXT_TOOL_INFO,
  describeMcpIndexTool,
  getMcpIndexToolDefinitions,
  resolveMcpIndexTool,
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

test('only enabled MCP servers and tools are exposed, capped at the limit', () => {
  const tools = Array.from({ length: MCP_EXTERNAL_TOOL_LIMIT + 4 }, (_, i) => ({ name: `tool_${i}`, enabled: true, inputSchema: { type: 'object' } }))
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

test('MCP index: two stable meta tools, one index line per enabled tool, no full schemas', () => {
  const servers = [
    { id: 'g1', name: '游戏', enabled: true, tools: [
      { name: 'move', enabled: true, description: '移动角色。可以走四个方向。', inputSchema: { type: 'object', properties: { dir: { type: 'string', enum: ['n', 's', 'e', 'w'] } }, required: ['dir'] } },
      { name: 'look', enabled: true, description: '看看周围', annotations: { readOnlyHint: true } },
      { name: 'hidden', enabled: false },
    ] },
    { id: 'off', name: '关着', enabled: false, tools: [{ name: 'x', enabled: true }] },
  ]
  const defs = getMcpIndexToolDefinitions(servers)
  assert.deepEqual(defs.map((d) => d.name), [EXT_TOOL_INFO, EXT_TOOL_CALL])
  const index = defs[0].description
  assert.match(index, /- move（游戏·可写）：移动角色。；必填 dir/)
  assert.match(index, /- look（游戏·只读）：看看周围/)
  assert.ok(!index.includes('hidden') && !index.includes('- x（'))
  assert.ok(!index.includes('enum'))
  assert.deepEqual(getMcpIndexToolDefinitions([{ id: 'off', name: 'off', enabled: false, tools: [{ name: 'x', enabled: true }] }]), [])
  const info = JSON.parse(describeMcpIndexTool('move', undefined, servers))
  assert.equal(info.parameters.properties.dir.enum.length, 4)
  assert.match(info.access, /没开写权限/)
  assert.throws(() => resolveMcpIndexTool('x', undefined, servers), /目录里没有/)
})

test('MCP index: same tool name on two servers needs server', () => {
  const servers = [
    { id: 'a', name: 'A', enabled: true, tools: [{ name: 'ping', enabled: true }] },
    { id: 'b', name: 'B', enabled: true, tools: [{ name: 'ping', enabled: true }] },
  ]
  assert.throws(() => resolveMcpIndexTool('ping', undefined, servers), /多个服务/)
  assert.equal(resolveMcpIndexTool('ping', 'B', servers).server.id, 'b')
})
