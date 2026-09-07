const test = require('node:test')
const assert = require('node:assert/strict')
const { listTools } = require('../mcp-remote')

function makeFetch(seen) {
  return async (_url, options) => {
    seen.push({ method: options.method, authorization: options.headers?.Authorization || '', body: options.body || '' })
    if (options.method === 'DELETE') return new Response(null, { status: 204 })
    const payload = JSON.parse(options.body)
    if (payload.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'test', version: '1' } } }), { status: 200, headers: { 'Content-Type': 'application/json', 'MCP-Session-Id': 'session' } })
    if (payload.method === 'notifications/initialized') return new Response('', { status: 202 })
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'read', inputSchema: { type: 'object' } }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
}

const lookup = async () => [{ address: '203.0.113.10', family: 4 }]

test('no-auth Streamable HTTP remains usable without an Authorization header', async () => {
  const seen = []
  const result = await listTools({ url: 'https://mcp.example/mcp' }, {}, { fetchImpl: makeFetch(seen), lookup })
  assert.equal(result.tools[0].name, 'read')
  assert.equal(seen.some((item) => item.authorization), false)
})

test('legacy Bearer remains attached only as an HTTP header', async () => {
  const seen = []
  await listTools({ url: 'https://mcp.example/mcp' }, { Authorization: 'Bearer backend-secret' }, { fetchImpl: makeFetch(seen), lookup })
  assert.ok(seen.filter((item) => item.method === 'POST').every((item) => item.authorization === 'Bearer backend-secret'))
  assert.equal(seen.some((item) => item.body.includes('backend-secret')), false)
})
