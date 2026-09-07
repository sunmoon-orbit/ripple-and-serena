const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { CLIENT_METADATA_PATH, createService, normalizePublicBase, publicServer } = require('../yanji-mcp')

function invoke(handler, { method = 'GET', path: requestPath, token = 'user-token', body, headers = {} } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.headers = { authorization: token ? `Bearer ${token}` : '', ...headers }
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

test('versioned client metadata uses the configured public origin and exact client_id bytes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yanji-mcp-'))
  const publicBase = 'https://oauth.example:8443/edge%2Ftenant/yanji-mcp///'
  const service = createService({ stateFile: path.join(root, 'state.json'), userToken: 'right', publicBase })
  const response = await invoke(service.handler, {
    path: `/raven/yanji-mcp${CLIENT_METADATA_PATH}`,
    token: '',
    headers: {
      host: '127.0.0.1:3400',
      'x-forwarded-host': 'attacker.invalid',
      'x-forwarded-proto': 'http',
      'x-forwarded-port': '3400',
    },
  })
  const metadata = JSON.parse(response.body)
  const expectedClientId = 'https://oauth.example:8443/edge%2Ftenant/yanji-mcp/oauth/client-metadata-v2.json'
  assert.equal(response.status, 200)
  assert.match(response.headers['Content-Type'], /^application\/json/)
  assert.equal(response.headers['Cache-Control'], 'no-store')
  assert.equal(Buffer.compare(Buffer.from(metadata.client_id), Buffer.from(expectedClientId)), 0)
  assert.deepEqual(metadata.redirect_uris, ['https://oauth.example:8443/edge%2Ftenant/yanji-mcp/oauth/callback'])
  assert.equal(JSON.stringify(metadata).includes('127.0.0.1'), false)
  assert.equal(JSON.stringify(metadata).includes('attacker.invalid'), false)
})

test('public OAuth base requires a path on a non-local HTTPS origin', () => {
  assert.equal(normalizePublicBase('https://memory.ravenlove.cc/raven/yanji-mcp/'), 'https://memory.ravenlove.cc/raven/yanji-mcp')
  for (const invalid of [
    'http://memory.ravenlove.cc/raven/yanji-mcp',
    'https://memory.ravenlove.cc/',
    'https://127.0.0.1:3400/raven/yanji-mcp',
    'https://service.local/raven/yanji-mcp',
  ]) assert.throws(() => normalizePublicBase(invalid), /公网 HTTPS URL|必须包含路径/)
})
