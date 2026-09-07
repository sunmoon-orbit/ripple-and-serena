const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { createService, publicServer } = require('../yanji-mcp')

function invoke(handler, { method = 'GET', path: requestPath, token = 'user-token', body } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.headers = { authorization: token ? `Bearer ${token}` : '' }
  const result = { status: 0, headers: {}, body: '' }
  const res = {
    writeHead(status, headers = {}) { result.status = status; result.headers = headers },
    end(value = '') { result.body += value; result.resolve(result) },
  }
  const promise = new Promise((resolve) => { result.resolve = resolve })
  void handler(req, res, new URL(requestPath, 'https://memory.ravenlove.cc'))
  queueMicrotask(() => { if (body) req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end') })
  return promise
}

test('legacy none and Bearer configs remain accepted while secrets stay backend-only', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yanji-mcp-'))
  const file = path.join(root, 'state.json')
  const service = createService({ stateFile: file, userToken: 'user-token' })
  let response = await invoke(service.handler, { method: 'PUT', path: '/raven/yanji-mcp/servers/none', body: { name: 'public', url: 'https://mcp.example/mcp', authType: 'none' } })
  assert.equal(response.status, 200)
  assert.equal(JSON.parse(response.body).server.authType, 'none')
  response = await invoke(service.handler, { method: 'PUT', path: '/raven/yanji-mcp/servers/legacy', body: { name: 'old', url: 'https://mcp.example/mcp', authType: 'bearer', bearerToken: 'manual-secret' } })
  const visible = JSON.parse(response.body).server
  assert.equal(visible.credentialStored, true)
  assert.equal(JSON.stringify(visible).includes('manual-secret'), false)
  assert.equal(service.state.servers.legacy.credential, 'manual-secret')
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
})

test('public server status never exposes OAuth, manual, or client secrets', () => {
  const result = publicServer({
    id: 'x', authType: 'oauth', credential: 'manual-secret',
    oauth: { client: { clientSecret: 'client-secret' }, tokens: { accessToken: 'access-secret', refreshToken: 'refresh-secret' } },
  })
  const text = JSON.stringify(result)
  for (const secret of ['manual-secret', 'client-secret', 'access-secret', 'refresh-secret']) assert.equal(text.includes(secret), false)
  assert.equal(result.oauthStatus, 'authorized')
})

test('unauthorized frontend cannot read MCP status', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yanji-mcp-'))
  const service = createService({ stateFile: path.join(root, 'state.json'), userToken: 'right' })
  const response = await invoke(service.handler, { path: '/raven/yanji-mcp/wake/status', token: 'wrong' })
  assert.equal(response.status, 401)
})

test('cancelled reauthorization keeps the previously valid OAuth token', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yanji-mcp-'))
  const service = createService({ stateFile: path.join(root, 'state.json'), userToken: 'right' })
  service.state.servers.remote = {
    id: 'remote', url: 'https://mcp.example/mcp', authType: 'oauth',
    oauth: { tokens: { accessToken: 'still-valid', refreshToken: 'refresh' } },
  }
  service.state.oauthPending.expected = {
    state: 'expected', serverId: 'remote', resource: 'https://mcp.example/mcp', expiresAt: Date.now() + 60_000,
  }
  service.persist()
  const response = await invoke(service.handler, {
    path: '/raven/yanji-mcp/oauth/callback?state=expected&error=access_denied', token: '',
  })
  assert.equal(response.status, 400)
  assert.equal(service.state.servers.remote.oauth.tokens.accessToken, 'still-valid')
  assert.equal(response.body.includes('still-valid'), false)
})
