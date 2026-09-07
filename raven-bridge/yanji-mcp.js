const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { createAndcoWake, cleanError } = require('./andco-wake')
const { assertPublicEndpoint, callTool, listTools } = require('./mcp-remote')
const {
  OAUTH_PENDING_TTL_MS, buildAuthorization, createPkce, discoverOAuth,
  exchangeAuthorizationCode, pollDeviceAuthorization, randomState, refreshAccessToken,
  registerClient, startDeviceAuthorization, validateCallback,
} = require('./mcp-oauth')

const BODY_LIMIT = 128 * 1024
const DEFAULT_PUBLIC_BASE = 'https://memory.ravenlove.cc/raven/yanji-mcp'
const APP_ORIGIN = 'https://sunmoon-orbit.github.io'

function emptyState() {
  return { version: 1, servers: {}, oauthPending: {}, wake: {}, wakePending: [] }
}

function loadState(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    return value && typeof value === 'object' ? { ...emptyState(), ...value } : emptyState()
  } catch { return emptyState() }
}

function saveState(file, state) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 })
  fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, file)
  fs.chmodSync(file, 0o600)
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function publicServer(server) {
  if (!server) return null
  const oauth = server.oauth
  return {
    id: server.id,
    name: server.name || '',
    url: server.url || '',
    authType: server.authType || 'none',
    credentialMode: server.credentialMode || 'bearer',
    enabled: server.enabled !== false,
    allowWrites: !!server.allowWrites,
    tools: Array.isArray(server.tools) ? server.tools : [],
    credentialStored: !!server.credential,
    oauthStatus: oauth?.tokens?.accessToken ? 'authorized' : oauth?.error ? 'reauthorize' : 'not_authorized',
    oauthError: oauth?.error ? cleanError(oauth.error) : '',
    lastConnectedAt: server.lastConnectedAt || 0,
    serverInfo: server.serverInfo || null,
  }
}

function normalizedTool(tool, oldTools) {
  const previous = (oldTools || []).find((item) => item.name === tool?.name)
  return {
    name: String(tool?.name || '').slice(0, 200),
    description: String(tool?.description || '').slice(0, 2000),
    inputSchema: tool?.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object', properties: {} },
    annotations: tool?.annotations && typeof tool.annotations === 'object' ? tool.annotations : {},
    enabled: previous?.enabled === true,
  }
}

function sanitizeServerInput(id, input, previous = {}) {
  const authType = ['none', 'bearer', 'manual', 'oauth'].includes(input.authType) ? input.authType : (previous.authType || 'none')
  const credentialMode = ['bearer', 'x-api-key', 'api-key'].includes(input.credentialMode)
    ? input.credentialMode : (previous.credentialMode || 'bearer')
  return {
    ...previous,
    id: String(id).slice(0, 120),
    name: String(input.name ?? previous.name ?? '').slice(0, 160),
    url: String(input.url ?? previous.url ?? '').trim().slice(0, 2000),
    authType,
    credentialMode,
    enabled: input.enabled === undefined ? previous.enabled !== false : input.enabled === true,
    allowWrites: input.allowWrites === undefined ? !!previous.allowWrites : input.allowWrites === true,
    oauthClientId: String(input.oauthClientId ?? previous.oauthClientId ?? '').slice(0, 1000),
    tools: Array.isArray(input.tools) ? input.tools.map((item) => ({ ...item, enabled: item?.enabled === true })) : (previous.tools || []),
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) { reject(Object.assign(new Error('请求过大'), { status: 413 })); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) }
      catch { reject(Object.assign(new Error('请求格式不正确'), { status: 400 })) }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function userError(error) {
  if (error?.status === 401) return 'MCP 身份验证失败，请重新授权或更新凭据'
  return cleanError(error)
}

function createService(options = {}) {
  const stateFile = options.stateFile || path.join(__dirname, '.yanji-mcp-state.json')
  const publicBase = String(options.publicBase || process.env.YANJI_MCP_PUBLIC_BASE || DEFAULT_PUBLIC_BASE).replace(/\/$/, '')
  const userToken = String(options.userToken || '')
  const fetchImpl = options.fetchImpl || fetch
  const guardedFetch = async (requestUrl, init) => {
    await assertPublicEndpoint(requestUrl, { allowLocal: options.allowLocal === true, lookup: options.lookup })
    return fetchImpl(requestUrl, init)
  }
  const state = loadState(stateFile)
  const persist = () => saveState(stateFile, state)
  const wake = createAndcoWake({
    state: state.wake,
    save: persist,
    deliver: async (event, { signal, chatId }) => {
      if (signal.aborted) throw new Error('已停止')
      state.wakePending = Array.isArray(state.wakePending) ? state.wakePending : []
      state.wakePending.push({ deliveryId: crypto.randomUUID(), chatId, event })
      state.wakePending = state.wakePending.slice(-50)
      persist()
    },
    now: options.now,
  })

  function serversList() { return Object.values(state.servers) }
  function authed(req) {
    const value = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    return timingSafeEqual(value, userToken)
  }
  async function ensureOAuthToken(server, force = false) {
    if (!server.oauth?.tokens?.accessToken) throw Object.assign(new Error('MCP 尚未完成网页授权'), { status: 401 })
    const expires = Number(server.oauth.tokens.expiresAt || 0)
    if (force || (expires && expires <= Date.now() + 60000)) {
      try {
        server.oauth.tokens = await refreshAccessToken({ oauth: server.oauth, fetchImpl: guardedFetch })
        delete server.oauth.error
        persist()
      } catch (error) {
        server.oauth.tokens = null
        server.oauth.error = 'OAuth 刷新失败，需要重新授权'
        persist()
        throw Object.assign(new Error(server.oauth.error), { status: 401 })
      }
    }
    return server.oauth.tokens.accessToken
  }
  async function authHeaders(server, forceRefresh = false) {
    if (server.authType === 'oauth') return { Authorization: `Bearer ${await ensureOAuthToken(server, forceRefresh)}` }
    if (server.authType === 'bearer' || server.authType === 'manual') {
      if (!server.credential) throw Object.assign(new Error('MCP 凭据尚未保存到后端'), { status: 401 })
      if (server.credentialMode === 'x-api-key') return { 'X-API-Key': server.credential }
      if (server.credentialMode === 'api-key') return { 'Api-Key': server.credential }
      return { Authorization: `Bearer ${server.credential}` }
    }
    return {}
  }
  async function runMcp(server, action) {
    let headers = await authHeaders(server)
    try { return await action(headers) }
    catch (error) {
      if (error?.status !== 401 || server.authType !== 'oauth' || !server.oauth?.tokens?.refreshToken) throw error
      headers = await authHeaders(server, true)
      return action(headers)
    }
  }

  async function handler(req, res, url) {
    const prefix = '/raven/yanji-mcp'
    const subpath = url.pathname.slice(prefix.length) || '/'
    const callbackPath = '/oauth/callback'
    const metadataPath = '/oauth/client-metadata.json'

    if (req.method === 'GET' && subpath === metadataPath) {
      return sendJson(res, 200, {
        client_name: '言叽', client_uri: `${APP_ORIGIN}/ripple-and-serena/yanji/`,
        redirect_uris: [`${publicBase}${callbackPath}`],
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
        token_endpoint_auth_method: 'none',
      })
    }

    if (req.method === 'GET' && subpath === callbackPath) {
      const stateValue = url.searchParams.get('state') || ''
      const pending = state.oauthPending[stateValue]
      delete state.oauthPending[stateValue]
      persist()
      let ok = false
      let message = '授权失败，请回到言叽重新授权。'
      try {
        validateCallback(pending, stateValue)
        if (url.searchParams.get('error')) throw new Error('用户取消了授权')
        const code = url.searchParams.get('code') || ''
        if (!code) throw new Error('授权回调缺少 code')
        const server = state.servers[pending.serverId]
        if (!server || server.url !== pending.resource) throw new Error('OAuth 回调与 MCP 配置不匹配')
        const tokens = await exchangeAuthorizationCode({ pending, code, fetchImpl: guardedFetch })
        server.oauth = { discovery: pending.discovery, client: pending.client, tokens, authorizedAt: Date.now() }
        persist()
        ok = true
        message = '授权完成，可以关闭本页回到言叽。'
      } catch (error) {
        if (pending?.serverId && state.servers[pending.serverId]) {
          const previousOauth = state.servers[pending.serverId].oauth || {}
          state.servers[pending.serverId].oauth = {
            ...previousOauth,
            error: userError(error),
            ...(previousOauth.tokens ? {} : { tokens: null }),
          }
          persist()
        }
      }
      const payload = JSON.stringify({ type: 'yanji-mcp-oauth', ok, serverId: pending?.serverId || '' }).replace(/</g, '\\u003c')
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" })
      res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>言叽 MCP 授权</title><style>body{font:16px system-ui;padding:32px;line-height:1.6;color:#333}</style><p>${message}</p><script>try{window.opener&&window.opener.postMessage(${payload},${JSON.stringify(APP_ORIGIN)})}catch{}${ok ? 'setTimeout(()=>window.close(),600)' : ''}</script>`)
      return
    }

    if (!authed(req)) return sendJson(res, 401, { error: 'unauthorized' })

    try {
      const serverMatch = subpath.match(/^\/servers\/([^/]+)(?:\/(discover|call|oauth\/start|oauth\/revoke|oauth\/device\/poll))?$/)
      if (serverMatch) {
        const id = decodeURIComponent(serverMatch[1])
        const action = serverMatch[2] || ''
        if (req.method === 'PUT' && !action) {
          const input = await readJson(req)
          const previous = state.servers[id] || {}
          const changedIdentity = previous.url && (previous.url !== String(input.url ?? previous.url) || previous.authType !== String(input.authType ?? previous.authType))
          const server = sanitizeServerInput(id, input, previous)
          if (changedIdentity) { delete server.oauth; delete server.credential; server.tools = [] }
          const supplied = input.credential ?? input.bearerToken
          if (typeof supplied === 'string' && supplied.trim()) server.credential = supplied.trim()
          state.servers[id] = server
          persist()
          return sendJson(res, 200, { server: publicServer(server) })
        }
        if (req.method === 'DELETE' && !action) {
          delete state.servers[id]
          if (state.wake.config?.serverId === id) wake.updateConfig({ enabled: false }, serversList())
          persist()
          return sendJson(res, 200, { ok: true })
        }
        const server = state.servers[id]
        if (!server) return sendJson(res, 404, { error: 'MCP 配置不存在' })
        if (req.method === 'GET' && !action) return sendJson(res, 200, { server: publicServer(server) })
        if (req.method === 'POST' && action === 'discover') {
          const result = await runMcp(server, (headers) => listTools(server, headers, { fetchImpl }))
          server.tools = result.tools.filter((tool) => tool?.name).map((tool) => normalizedTool(tool, server.tools))
          server.serverInfo = result.serverInfo
          server.lastConnectedAt = Date.now()
          persist()
          return sendJson(res, 200, { server: publicServer(server) })
        }
        if (req.method === 'POST' && action === 'call') {
          if (server.enabled === false) return sendJson(res, 409, { error: '这个 MCP 服务已经关闭' })
          const input = await readJson(req)
          const tool = server.tools.find((item) => item.name === input.name)
          if (!tool?.enabled) return sendJson(res, 403, { error: '这个 MCP 工具已经关闭' })
          if (tool.annotations?.readOnlyHint !== true && !server.allowWrites) return sendJson(res, 403, { error: '该工具可能写入外部状态，尚未获得允许' })
          const result = await runMcp(server, (headers) => callTool(server, headers, tool.name, input.arguments || {}, { fetchImpl }))
          return sendJson(res, 200, { result })
        }
        if (req.method === 'POST' && action === 'oauth/start') {
          if (server.authType !== 'oauth') return sendJson(res, 409, { error: '这个 MCP 没有选择 OAuth' })
          const discovery = await discoverOAuth({ resource: server.url, fetchImpl: guardedFetch })
          const redirectUri = `${publicBase}${callbackPath}`
          const client = await registerClient({
            discovery, clientMetadataUrl: `${publicBase}${metadataPath}`, redirectUri,
            clientId: server.oauthClientId, fetchImpl: guardedFetch,
          })
          if (!discovery.authorizationMetadata.authorization_endpoint) {
            const device = await startDeviceAuthorization({ discovery, client, fetchImpl: guardedFetch })
            server.oauth = { discovery, client, device, tokens: null }
            persist()
            return sendJson(res, 200, { flow: 'device', userCode: device.userCode, verificationUri: device.verificationUri, expiresAt: device.expiresAt, intervalSeconds: device.intervalSeconds })
          }
          const pkce = createPkce()
          const stateValue = randomState()
          state.oauthPending[stateValue] = {
            state: stateValue, serverId: id, resource: server.url, discovery, client,
            verifier: pkce.verifier, redirectUri, expiresAt: Date.now() + OAUTH_PENDING_TTL_MS,
          }
          for (const [key, value] of Object.entries(state.oauthPending)) {
            if (value.expiresAt <= Date.now()) delete state.oauthPending[key]
          }
          persist()
          return sendJson(res, 200, { flow: 'web', authorizationUrl: buildAuthorization({ discovery, client, redirectUri, state: stateValue, pkce }) })
        }
        if (req.method === 'POST' && action === 'oauth/device/poll') {
          if (!server.oauth?.device) return sendJson(res, 409, { error: '没有待完成的设备码授权' })
          const result = await pollDeviceAuthorization({
            discovery: server.oauth.discovery, client: server.oauth.client,
            device: server.oauth.device, fetchImpl: guardedFetch,
          })
          if (result.pending) { persist(); return sendJson(res, 202, result) }
          server.oauth.tokens = result.tokens
          delete server.oauth.device
          delete server.oauth.error
          server.oauth.authorizedAt = Date.now()
          persist()
          return sendJson(res, 200, { server: publicServer(server) })
        }
        if (req.method === 'POST' && action === 'oauth/revoke') {
          const oauth = server.oauth
          const endpoint = oauth?.discovery?.authorizationMetadata?.revocation_endpoint
          if (endpoint && oauth?.tokens?.accessToken) {
            const body = new URLSearchParams({ token: oauth.tokens.accessToken, client_id: oauth.client.clientId })
            if (oauth.client.clientSecret) body.set('client_secret', oauth.client.clientSecret)
            await guardedFetch(endpoint, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(12000) }).catch(() => {})
          }
          delete server.oauth
          persist()
          return sendJson(res, 200, { server: publicServer(server) })
        }
      }

      if (subpath === '/wake/status' && req.method === 'GET') return sendJson(res, 200, wake.status(serversList()))
      if (subpath === '/wake/config' && req.method === 'PUT') {
        const input = await readJson(req)
        return sendJson(res, 200, wake.updateConfig(input, serversList()))
      }
      if (subpath === '/wake/pending' && req.method === 'GET') {
        const status = wake.status(serversList())
        if (!status.active) return sendJson(res, 200, { delivery: null })
        const delivery = state.wakePending[0] || null
        return sendJson(res, 200, { delivery })
      }
      if (subpath === '/wake/ack' && req.method === 'POST') {
        const input = await readJson(req)
        const first = state.wakePending[0]
        if (first && timingSafeEqual(first.deliveryId, input.deliveryId)) state.wakePending.shift()
        persist()
        return sendJson(res, 200, { ok: true })
      }
      return sendJson(res, 404, { error: 'not found' })
    } catch (error) {
      return sendJson(res, error?.status || 400, { error: userError(error) })
    }
  }

  return { handler, state, wake, publicServer, persist }
}

module.exports = { createService, loadState, publicServer, saveState, timingSafeEqual }
