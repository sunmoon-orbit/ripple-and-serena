const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const {
  authorizationMetadataCandidates, createPkce, discoverOAuth, parseBearerChallenge,
  protectedResourceCandidates, refreshAccessToken, startDeviceAuthorization, validateCallback,
} = require('../mcp-oauth')

function response(status, body, headers = {}) {
  return new Response(body == null ? '' : JSON.stringify(body), {
    status, headers: { ...(body == null ? {} : { 'Content-Type': 'application/json' }), ...headers },
  })
}

test('PKCE uses a verifier and matching S256 challenge', () => {
  const pkce = createPkce()
  assert.equal(pkce.method, 'S256')
  assert.ok(pkce.verifier.length >= 43 && pkce.verifier.length <= 128)
  assert.equal(pkce.challenge, crypto.createHash('sha256').update(pkce.verifier).digest('base64url'))
})

test('state rejects callback mixups and expiry', () => {
  const first = { state: 'one', expiresAt: 2000 }
  const second = { state: 'two', expiresAt: 2000 }
  assert.throws(() => validateCallback(first, second.state, 1000), /state/)
  assert.throws(() => validateCallback(first, first.state, 2001), /过期/)
  assert.equal(validateCallback(first, first.state, 1000), true)
})

test('OAuth discovery follows RFC 9728 challenge and authorization metadata', async () => {
  const calls = []
  const fakeFetch = async (url) => {
    calls.push(String(url))
    if (url === 'https://andco.example/mcp') return response(401, null, { 'WWW-Authenticate': 'Bearer resource_metadata="https://andco.example/meta", scope="chat.read chat.write"' })
    if (url === 'https://andco.example/meta') return response(200, { resource: 'https://andco.example/mcp', authorization_servers: ['https://auth.andco.example'] })
    if (url === 'https://auth.andco.example/.well-known/oauth-authorization-server') return response(200, {
      issuer: 'https://auth.andco.example', authorization_endpoint: 'https://auth.andco.example/authorize',
      token_endpoint: 'https://auth.andco.example/token', code_challenge_methods_supported: ['S256'],
    })
    return response(404, null)
  }
  const result = await discoverOAuth({ resource: 'https://andco.example/mcp', fetchImpl: fakeFetch })
  assert.equal(result.scope, 'chat.read chat.write')
  assert.equal(result.authorizationMetadata.token_endpoint, 'https://auth.andco.example/token')
  assert.deepEqual(calls.slice(0, 3), ['https://andco.example/mcp', 'https://andco.example/meta', 'https://auth.andco.example/.well-known/oauth-authorization-server'])
})

test('OAuth discovery refuses servers that do not declare PKCE S256', async () => {
  const fakeFetch = async (url) => {
    if (String(url).endsWith('/mcp')) return response(401, null)
    if (String(url).includes('oauth-protected-resource')) return response(200, { authorization_servers: ['https://auth.example'] })
    if (String(url).includes('oauth-authorization-server')) return response(200, { issuer: 'https://auth.example', authorization_endpoint: 'https://auth.example/a', token_endpoint: 'https://auth.example/t' })
    return response(404, null)
  }
  await assert.rejects(discoverOAuth({ resource: 'https://service.example/mcp', fetchImpl: fakeFetch }), /PKCE S256/)
})

test('OAuth discovery rejects protected-resource mixups', async () => {
  const fakeFetch = async (url) => {
    if (String(url).endsWith('/mcp')) return response(401, null)
    if (String(url).includes('oauth-protected-resource')) return response(200, {
      resource: 'https://other.example/mcp', authorization_servers: ['https://auth.example'],
    })
    return response(404, null)
  }
  await assert.rejects(discoverOAuth({ resource: 'https://service.example/mcp', fetchImpl: fakeFetch }), /不匹配/)
})

test('refresh failure is fail-closed and does not expose provider details', async () => {
  const oauth = {
    tokens: { refreshToken: 'refresh-secret' }, client: { clientId: 'client' },
    discovery: { resource: 'https://service.example/mcp', authorizationMetadata: { token_endpoint: 'https://auth.example/token' } },
  }
  await assert.rejects(
    refreshAccessToken({ oauth, fetchImpl: async () => response(400, { error: 'invalid_grant', error_description: 'refresh-secret' }) }),
    (error) => error.message === 'OAuth 刷新失败，需要重新授权' && !error.message.includes('refresh-secret'),
  )
})

test('well-known candidate construction handles endpoint and issuer paths', () => {
  assert.deepEqual(protectedResourceCandidates('https://example.com/team/mcp'), [
    'https://example.com/.well-known/oauth-protected-resource/team/mcp',
    'https://example.com/.well-known/oauth-protected-resource',
  ])
  assert.equal(authorizationMetadataCandidates('https://auth.example/tenant')[0], 'https://auth.example/.well-known/oauth-authorization-server/tenant')
  assert.equal(parseBearerChallenge('Bearer resource_metadata="https://example.com/meta", scope="a b"').scope, 'a b')
})

test('device authorization is accepted only when metadata explicitly declares its grant', async () => {
  const base = {
    resource: 'https://service.example/mcp', scope: '',
    authorizationMetadata: { device_authorization_endpoint: 'https://auth.example/device' },
  }
  await assert.rejects(startDeviceAuthorization({ discovery: base, client: { clientId: 'client' }, fetchImpl: async () => response(500, {}) }), /没有声明设备码/)
  const discovery = { ...base, authorizationMetadata: { ...base.authorizationMetadata, grant_types_supported: ['urn:ietf:params:oauth:grant-type:device_code'] } }
  const result = await startDeviceAuthorization({
    discovery, client: { clientId: 'client' },
    fetchImpl: async () => response(200, { device_code: 'backend-only', user_code: 'ABCD-EFGH', verification_uri: 'https://auth.example/verify', expires_in: 600, interval: 8 }),
  })
  assert.equal(result.userCode, 'ABCD-EFGH')
  assert.equal(result.deviceCode, 'backend-only')
  assert.equal(result.intervalSeconds, 8)
})
