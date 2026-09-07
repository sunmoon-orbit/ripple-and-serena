const crypto = require('crypto')

const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

function createPkce() {
  const verifier = base64url(crypto.randomBytes(48))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge, method: 'S256' }
}

function randomState() {
  return base64url(crypto.randomBytes(32))
}

function safeUrl(raw, label = 'OAuth URL') {
  let url
  try { url = new URL(String(raw || '')) } catch { throw new Error(`${label} 无效`) }
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV === 'test' && url.protocol === 'http:')) {
    throw new Error(`${label} 必须使用 HTTPS`)
  }
  if (url.username || url.password || url.hash) throw new Error(`${label} 含有不安全字段`)
  return url
}

function protectedResourceCandidates(resource) {
  const url = safeUrl(resource, 'MCP URL')
  const path = url.pathname.replace(/^\/+|\/+$/g, '')
  const out = []
  if (path) out.push(new URL(`/.well-known/oauth-protected-resource/${path}`, url.origin).href)
  out.push(new URL('/.well-known/oauth-protected-resource', url.origin).href)
  return [...new Set(out)]
}

function authorizationMetadataCandidates(issuer) {
  const url = safeUrl(issuer, '授权服务器地址')
  const path = url.pathname.replace(/^\/+|\/+$/g, '')
  if (!path) {
    return [
      new URL('/.well-known/oauth-authorization-server', url.origin).href,
      new URL('/.well-known/openid-configuration', url.origin).href,
    ]
  }
  return [
    new URL(`/.well-known/oauth-authorization-server/${path}`, url.origin).href,
    new URL(`/.well-known/openid-configuration/${path}`, url.origin).href,
    new URL(`${url.pathname.replace(/\/$/, '')}/.well-known/openid-configuration`, url.origin).href,
  ]
}

function parseBearerChallenge(value) {
  const text = String(value || '')
  const bearer = text.match(/(?:^|,)\s*Bearer\s+([^,]*(?:,(?!\s*[A-Za-z][A-Za-z0-9_-]*\s)[^,]*)*)/i)
  const attrs = bearer ? bearer[1] : text
  const result = {}
  for (const match of attrs.matchAll(/([A-Za-z][A-Za-z0-9_-]*)=(?:"((?:\\.|[^"])*)"|([^,\s]+))/g)) {
    result[match[1].toLowerCase()] = (match[2] ?? match[3] ?? '').replace(/\\"/g, '"')
  }
  return result
}

async function fetchJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(12000) })
  if (!response.ok) return null
  const type = response.headers.get('content-type') || ''
  if (!/json/i.test(type)) return null
  const body = await response.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null
}

async function discoverOAuth({ resource, fetchImpl = fetch }) {
  const resourceUrl = safeUrl(resource, 'MCP URL').href
  let challengedMetadata = ''
  let challengedScope = ''
  try {
    const probe = await fetchImpl(resourceUrl, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'oauth-probe', method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'yanji', version: '2.0.0' } } }),
    })
    if (probe.status === 401) {
      const challenge = parseBearerChallenge(probe.headers.get('www-authenticate'))
      challengedMetadata = challenge.resource_metadata || ''
      challengedScope = challenge.scope || ''
    }
  } catch { /* fall through to well-known discovery */ }

  const resourceCandidates = challengedMetadata
    ? [safeUrl(challengedMetadata, '资源元数据地址').href]
    : protectedResourceCandidates(resourceUrl)
  let protectedMetadata = null
  for (const candidate of resourceCandidates) {
    protectedMetadata = await fetchJson(fetchImpl, candidate)
    if (protectedMetadata) break
  }
  if (!protectedMetadata) throw new Error('服务没有提供标准 MCP OAuth 资源元数据')
  if (protectedMetadata.resource) {
    const declaredResource = safeUrl(protectedMetadata.resource, '资源标识').href
    if (declaredResource !== resourceUrl) throw new Error('资源元数据与 MCP 地址不匹配')
  }
  const issuers = Array.isArray(protectedMetadata.authorization_servers)
    ? protectedMetadata.authorization_servers.filter(Boolean)
    : []
  if (!issuers.length) throw new Error('MCP 资源元数据没有声明授权服务器')

  let authorizationMetadata = null
  let issuer = ''
  for (const candidateIssuer of issuers) {
    issuer = safeUrl(candidateIssuer, '授权服务器地址').href.replace(/\/$/, '')
    for (const candidate of authorizationMetadataCandidates(issuer)) {
      authorizationMetadata = await fetchJson(fetchImpl, candidate)
      if (authorizationMetadata) break
    }
    if (authorizationMetadata) break
  }
  if (!authorizationMetadata) throw new Error('找不到授权服务器元数据')
  if (authorizationMetadata.issuer && authorizationMetadata.issuer.replace(/\/$/, '') !== issuer) {
    throw new Error('授权服务器元数据 issuer 不匹配')
  }
  const pkce = authorizationMetadata.code_challenge_methods_supported
  if (authorizationMetadata.authorization_endpoint && (!Array.isArray(pkce) || !pkce.includes('S256'))) {
    throw new Error('授权服务器未声明 PKCE S256，已拒绝不安全授权')
  }
  if (authorizationMetadata.authorization_endpoint) safeUrl(authorizationMetadata.authorization_endpoint, '授权入口')
  if (authorizationMetadata.token_endpoint) safeUrl(authorizationMetadata.token_endpoint, '令牌入口')
  if (!authorizationMetadata.token_endpoint) throw new Error('授权服务器没有声明令牌入口')
  const deviceGrant = 'urn:ietf:params:oauth:grant-type:device_code'
  const deviceDeclared = !!authorizationMetadata.device_authorization_endpoint &&
    Array.isArray(authorizationMetadata.grant_types_supported) && authorizationMetadata.grant_types_supported.includes(deviceGrant)
  if (!authorizationMetadata.authorization_endpoint && !deviceDeclared) throw new Error('授权服务器没有声明可用的网页或设备授权流程')

  const scope = challengedScope || (Array.isArray(protectedMetadata.scopes_supported)
    ? protectedMetadata.scopes_supported.join(' ')
    : '')
  return { resource: resourceUrl, protectedMetadata, authorizationMetadata, issuer, scope }
}

async function startDeviceAuthorization({ discovery, client, fetchImpl = fetch }) {
  const metadata = discovery.authorizationMetadata
  const grant = 'urn:ietf:params:oauth:grant-type:device_code'
  if (!metadata.device_authorization_endpoint || !Array.isArray(metadata.grant_types_supported) || !metadata.grant_types_supported.includes(grant)) {
    throw new Error('授权服务器没有声明设备码流程')
  }
  const body = new URLSearchParams({ client_id: client.clientId, resource: discovery.resource })
  if (discovery.scope) body.set('scope', discovery.scope)
  const response = await fetchImpl(safeUrl(metadata.device_authorization_endpoint, '设备授权入口').href, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.device_code || !result.user_code || !(result.verification_uri || result.verification_url)) throw new Error('设备码授权启动失败')
  return {
    deviceCode: String(result.device_code), userCode: String(result.user_code),
    verificationUri: safeUrl(result.verification_uri_complete || result.verification_uri || result.verification_url, '设备验证地址').href,
    expiresAt: Date.now() + Math.min(1800, Math.max(60, Number(result.expires_in) || 600)) * 1000,
    intervalSeconds: Math.min(60, Math.max(5, Number(result.interval) || 5)), nextPollAt: 0,
  }
}

async function pollDeviceAuthorization({ discovery, client, device, fetchImpl = fetch }) {
  if (!device?.deviceCode || device.expiresAt <= Date.now()) throw new Error('设备码已过期，需要重新授权')
  if (device.nextPollAt && device.nextPollAt > Date.now()) return { pending: true, retryAfter: Math.ceil((device.nextPollAt - Date.now()) / 1000) }
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: device.deviceCode,
    client_id: client.clientId, resource: discovery.resource,
  })
  if (client.clientSecret) body.set('client_secret', client.clientSecret)
  const response = await fetchImpl(safeUrl(discovery.authorizationMetadata.token_endpoint, '令牌入口').href, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (result.error === 'authorization_pending' || result.error === 'slow_down') {
      if (result.error === 'slow_down') device.intervalSeconds = Math.min(60, device.intervalSeconds + 5)
      device.nextPollAt = Date.now() + device.intervalSeconds * 1000
      return { pending: true, retryAfter: device.intervalSeconds }
    }
    throw new Error('设备码授权失败，需要重新授权')
  }
  if (!result.access_token) throw new Error('设备码授权没有返回访问令牌')
  return { pending: false, tokens: {
    accessToken: String(result.access_token), refreshToken: String(result.refresh_token || ''),
    tokenType: String(result.token_type || 'Bearer'), scope: String(result.scope || ''),
    expiresAt: result.expires_in ? Date.now() + Math.max(0, Number(result.expires_in)) * 1000 : 0,
  } }
}

async function registerClient({ discovery, clientMetadataUrl, redirectUri, clientId, fetchImpl = fetch }) {
  const metadata = discovery.authorizationMetadata
  if (clientId) return { clientId: String(clientId), clientSecret: '' }
  if (metadata.client_id_metadata_document_supported === true) {
    return { clientId: safeUrl(clientMetadataUrl, '客户端元数据地址').href, clientSecret: '' }
  }
  if (!metadata.registration_endpoint) throw new Error('授权服务器不支持客户端元数据或动态注册，请填写已注册的 Client ID')
  const response = await fetchImpl(safeUrl(metadata.registration_endpoint, '动态注册入口').href, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: '言叽',
      redirect_uris: [redirectUri],
      grant_types: [
        ...(metadata.authorization_endpoint ? ['authorization_code'] : []),
        ...(Array.isArray(metadata.grant_types_supported) && metadata.grant_types_supported.includes('urn:ietf:params:oauth:grant-type:device_code') ? ['urn:ietf:params:oauth:grant-type:device_code'] : []),
        'refresh_token',
      ],
      response_types: metadata.authorization_endpoint ? ['code'] : [],
      token_endpoint_auth_method: 'none',
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.client_id) throw new Error('OAuth 客户端动态注册失败')
  return { clientId: String(body.client_id), clientSecret: String(body.client_secret || '') }
}

function buildAuthorization({ discovery, client, redirectUri, state, pkce }) {
  if (!discovery.authorizationMetadata.authorization_endpoint) throw new Error('授权服务器没有声明网页授权入口')
  const url = safeUrl(discovery.authorizationMetadata.authorization_endpoint, '授权入口')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', client.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', pkce.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('resource', discovery.resource)
  if (discovery.scope) url.searchParams.set('scope', discovery.scope)
  return url.href
}

async function tokenRequest({ endpoint, params, client, fetchImpl = fetch }) {
  const body = new URLSearchParams(params)
  body.set('client_id', client.clientId)
  if (client.clientSecret) body.set('client_secret', client.clientSecret)
  const response = await fetchImpl(safeUrl(endpoint, '令牌入口').href, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.access_token) {
    const error = new Error('OAuth 令牌交换失败')
    error.oauthCode = String(result.error || '')
    throw error
  }
  return {
    accessToken: String(result.access_token),
    refreshToken: result.refresh_token ? String(result.refresh_token) : '',
    tokenType: String(result.token_type || 'Bearer'),
    scope: String(result.scope || ''),
    expiresAt: result.expires_in ? Date.now() + Math.max(0, Number(result.expires_in)) * 1000 : 0,
  }
}

async function exchangeAuthorizationCode({ pending, code, fetchImpl = fetch }) {
  return tokenRequest({
    endpoint: pending.discovery.authorizationMetadata.token_endpoint,
    client: pending.client,
    fetchImpl,
    params: {
      grant_type: 'authorization_code', code, redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier, resource: pending.discovery.resource,
    },
  })
}

async function refreshAccessToken({ oauth, fetchImpl = fetch }) {
  if (!oauth?.tokens?.refreshToken) throw new Error('OAuth 授权已过期，需要重新授权')
  try {
    const next = await tokenRequest({
      endpoint: oauth.discovery.authorizationMetadata.token_endpoint,
      client: oauth.client,
      fetchImpl,
      params: {
        grant_type: 'refresh_token', refresh_token: oauth.tokens.refreshToken,
        resource: oauth.discovery.resource,
      },
    })
    if (!next.refreshToken) next.refreshToken = oauth.tokens.refreshToken
    return next
  } catch {
    throw new Error('OAuth 刷新失败，需要重新授权')
  }
}

function validateCallback(pending, state, now = Date.now()) {
  if (!pending || !state || state !== pending.state) throw new Error('OAuth state 校验失败')
  if (pending.expiresAt <= now) throw new Error('OAuth 授权请求已过期')
  return true
}

module.exports = {
  OAUTH_PENDING_TTL_MS,
  authorizationMetadataCandidates,
  buildAuthorization,
  createPkce,
  discoverOAuth,
  exchangeAuthorizationCode,
  parseBearerChallenge,
  protectedResourceCandidates,
  randomState,
  refreshAccessToken,
  registerClient,
  safeUrl,
  startDeviceAuthorization,
  pollDeviceAuthorization,
  tokenRequest,
  validateCallback,
}
