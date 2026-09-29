const crypto = require('crypto')

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (Buffer.byteLength(body) > limit) {
        reject(Object.assign(new Error('body_too_large'), { status: 413 }))
        req.destroy()
      }
    })
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')) }
      catch { reject(Object.assign(new Error('invalid_json'), { status: 400 })) }
    })
    req.on('error', reject)
  })
}

function compactText(value, max = 50000) { return String(value || '').trim().slice(0, max) }

const AVATAR_PEOPLE = new Set(['aying', 'lianyan', 'yao'])
const AVATAR_STATE_KEY = 'roundtable_avatars_v1'

function safeAvatarUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (!raw.startsWith('/raven/uploads/')) throw Object.assign(new Error('invalid_avatar_url'), { status: 400 })
  let filename
  try { filename = decodeURIComponent(raw.slice('/raven/uploads/'.length)) }
  catch { throw Object.assign(new Error('invalid_avatar_url'), { status: 400 }) }
  if (!filename || filename.length > 240 || filename !== require('path').basename(filename)) {
    throw Object.assign(new Error('invalid_avatar_url'), { status: 400 })
  }
  return '/raven/uploads/' + encodeURIComponent(filename)
}

function extractAgentText(item) {
  if (!item || item.type !== 'agentMessage') return ''
  if (typeof item.text === 'string') return item.text.trim()
  if (typeof item.content === 'string') return item.content.trim()
  if (Array.isArray(item.content)) {
    return item.content.map(part => typeof part === 'string' ? part : part?.text || part?.content || '').join('').trim()
  }
  return ''
}

function finalFromThread(result, turnId) {
  const turns = result?.thread?.turns || result?.turns || []
  const turn = turns.find(entry => (entry.id || entry.turnId) === turnId) || turns.at(-1)
  const items = turn?.items || turn?.output || []
  for (let i = items.length - 1; i >= 0; i--) {
    const text = extractAgentText(items[i])
    if (text) return text
  }
  return ''
}

function createRoundtable(options) {
  const moonGet = options.moonGet
  const moonPost = options.moonPost
  const broadcast = options.broadcast || (() => {})
  const tmuxSend = options.tmuxSend || (() => false)
  const ccBusy = options.ccBusy || (() => false)
  const ccOnline = options.ccOnline || (() => false)
  const crossing = options.crossing
  const logger = options.logger || console
  const approvals = new Map()
  const turns = new Map()
  const finalByTurn = new Map()
  let ticking = false
  let recovering = false
  let finishing = false
  let cachedCounts = { lianyan: {}, yao: {} }

  async function request(path, body, method = 'POST') {
    const response = await moonPost(path, body, method)
    if (response.status < 200 || response.status >= 300) {
      const error = new Error(response.data?.error || `moon-memory_${response.status}`)
      error.status = response.status
      error.retryable = response.status >= 500
      throw error
    }
    return response.data
  }

  function publish(result) {
    if (!result?.created) return
    for (const message of result.messages || []) {
      broadcast({ type: 'roundtable/message', message })
      if (['lianyan', 'yao'].includes(message.from) && message.mentions?.includes('aying')) {
        void request('/push/send-fixed', {
          title: `圆桌 · ${message.from === 'lianyan' ? '涟言' : '林曜'}`,
          body: compactText(message.text, 80), target: 'raven', ttl: 21600,
          dedupeKey: `roundtable:${message.id}`,
          data: { type: 'roundtable_mention', messageId: message.id },
        }).catch(error => logger.error('[roundtable] @阿颖推送失败:', error.message))
      }
    }
    kick()
  }

  async function ingest(input) {
    return request('/roundtable/messages', input)
  }

  async function avatars() {
    const state = await moonGet(`/roundtable/state/${AVATAR_STATE_KEY}`)
    let parsed = {}
    try { parsed = JSON.parse(state.value || '{}') } catch {}
    const result = {}
    for (const person of AVATAR_PEOPLE) {
      try { result[person] = safeAvatarUrl(parsed?.[person]) } catch { result[person] = '' }
    }
    return result
  }

  function senderName(sender) {
    return sender === 'aying' ? '阿颖' : sender === 'lianyan' ? '涟言' : sender === 'yao' ? '林曜' : '系统'
  }

  function localSnapshot() {
    const diag = crossing.diagnostics()
    const lianyanQueued = Number(cachedCounts.lianyan?.pending || 0) + Number(cachedCounts.lianyan?.leased || 0)
    const yaoQueued = Number(cachedCounts.yao?.pending || 0) + Number(cachedCounts.yao?.leased || 0)
    const lianyan = !ccOnline() ? '离线' : ccBusy() ? '正在终端干活' : lianyanQueued ? `空闲，排队${lianyanQueued}条` : '空闲'
    const yao = diag.pendingApprovals ? '等待阿颖批准' : diag.activeTurn
      ? (diag.activeOwner === 'roundtable' ? '正在圆桌干活' : diag.orphaned ? '渡口断线宽限中' : '正在渡口干活')
      : yaoQueued ? `空闲，排队${yaoQueued}条` : '空闲'
    return { text: `涟言=${lianyan}；林曜=${yao}`, diag }
  }

  function claudeEnvelope(message) {
    const supplemental = ccBusy() ? '·补充' : ''
    return `【圆桌·${senderName(message.from)}${supplemental}】【id=${message.id}｜话题=${message.rootId}｜AI叫醒=${message.aiWakeNo || 0}/6】【同桌：${localSnapshot().text}】 ${message.text} 【回：/raven/roundtable/say replyTo=${message.id}】`
  }

  function recentContext(messages) {
    return messages.map(message => `${senderName(message.from)}：${message.text}`).join('\n')
  }

  function codexEnvelope(message, recent, firstTurn) {
    const protocol = [
      '你现在在归巢的三人圆桌里，成员是阿颖、涟言和林曜（你）。',
      '只回复要放上桌的正文，不要解释传输方式。普通回复不会叫醒涟言；要请他接话时明确写 @涟言。',
      `本条消息 id=${message.id}，话题=${message.rootId}，AI叫醒=${message.aiWakeNo || 0}/6。`,
      `【同桌状态】${localSnapshot().text}。同桌已在做同一件事时，请补充或审阅，不要重复开工。`,
    ]
    if (firstTurn && recent.length) protocol.push(`【圆桌最近消息】\n${recentContext(recent)}`)
    protocol.push(`【本次要回复】${senderName(message.from)}：${message.text}`)
    return protocol.join('\n')
  }

  async function patchDelivery(id, status, extra = {}) {
    return request(`/roundtable/deliveries/${id}`, { status, ...extra }, 'PATCH')
  }

  async function processLianyan() {
    const claimed = await request('/roundtable/deliveries/claim', { target: 'lianyan', leaseMs: 30000 })
    const delivery = claimed.delivery
    if (!delivery) return false
    if (!tmuxSend(claudeEnvelope(delivery.message))) {
      await patchDelivery(delivery.id, 'pending', { lastError: 'cc_unavailable' })
      return false
    }
    await patchDelivery(delivery.id, 'submitted')
    return true
  }

  async function processYao() {
    const diag = crossing.diagnostics()
    if (finishing || diag.activeTurn || diag.startingTurn || diag.pendingApprovals) return false
    const claimed = await request('/roundtable/deliveries/claim', { target: 'yao', leaseMs: 120000 })
    const delivery = claimed.delivery
    if (!delivery) return false
    try {
      const state = await moonGet('/roundtable/state/codex_thread_id')
      let threadId = state.value || ''
      let recent = []
      if (!threadId) recent = (await moonGet('/roundtable/messages?limit=12')).messages || []
      const started = await crossing.startInternalTurn({
        threadId,
        text: codexEnvelope(delivery.message, recent, !threadId),
        clientUserMessageId: delivery.message.id,
      })
      threadId = started.threadId
      if (state.value !== threadId) await request('/roundtable/state/codex_thread_id', { value: threadId }, 'PUT')
      turns.set(started.turnId, { deliveryId: delivery.id, replyTo: delivery.message.id, threadId })
      await patchDelivery(delivery.id, 'running', { runtimeThreadId: threadId, runtimeTurnId: started.turnId })
      return true
    } catch (error) {
      await patchDelivery(delivery.id, /thread|线程/i.test(error.message) ? 'blocked' : 'pending', { lastError: error.message }).catch(() => {})
      throw error
    }
  }

  async function recoverRunningYao() {
    if (recovering) return
    recovering = true
    try {
      const data = await moonGet('/roundtable/deliveries?target=yao&status=running&limit=50')
      for (const delivery of data.deliveries || []) {
        if (turns.has(delivery.runtime_turn_id)) continue
        if (!delivery.runtime_thread_id || !delivery.runtime_turn_id) {
          await patchDelivery(delivery.id, 'blocked', { lastError: 'bridge_restarted_before_turn_identity_was_saved' })
          continue
        }
        let result
        try { result = await crossing.readInternalThread(delivery.runtime_thread_id) }
        catch { return } // app-server 还没起来，下一轮再对账，不能误判成失败
        const text = finalFromThread(result, delivery.runtime_turn_id)
        if (!text) {
          await patchDelivery(delivery.id, 'blocked', { lastError: 'bridge_restarted_and_no_final_reply_was_found' })
          continue
        }
        const stored = await ingest({
          from: 'yao', idempotencyKey: `codex:${delivery.runtime_thread_id}:${delivery.runtime_turn_id}`,
          text, replyTo: delivery.message.id, attachments: [],
        })
        publish(stored)
        await patchDelivery(delivery.id, 'done')
      }
    } catch (error) {
      logger.error('[roundtable] 重启对账失败:', error.message)
    } finally { recovering = false }
  }

  async function tick() {
    if (ticking) return
    ticking = true
    try {
      cachedCounts = await moonGet('/roundtable/counts').catch(() => cachedCounts)
      await recoverRunningYao()
      await Promise.allSettled([processLianyan(), processYao()])
      broadcast({ type: 'roundtable/status', agents: await status() })
    } catch (error) {
      logger.error('[roundtable] 调度失败:', error.message)
    } finally { ticking = false }
  }

  function kick() { setTimeout(() => void tick(), 0).unref?.() }

  async function status() {
    cachedCounts = await moonGet('/roundtable/counts').catch(() => cachedCounts)
    const diag = crossing.diagnostics()
    const queued = who => Number(cachedCounts[who]?.pending || 0) + Number(cachedCounts[who]?.leased || 0)
    const submitted = who => Number(cachedCounts[who]?.submitted || 0) + Number(cachedCounts[who]?.running || 0)
    let lianyanState = 'idle'
    if (!ccOnline()) lianyanState = 'offline'
    else if (ccBusy()) lianyanState = 'working'
    else if (queued('lianyan')) lianyanState = 'queued'
    let yaoState = 'idle'
    if (diag.childState === 'offline') yaoState = 'offline'
    else if (diag.pendingApprovals) yaoState = 'waiting_approval'
    else if (diag.orphaned) yaoState = 'reconnecting'
    else if (diag.activeTurn) yaoState = 'working'
    else if (queued('yao')) yaoState = 'queued'
    return {
      lianyan: { state: lianyanState, surface: submitted('lianyan') ? 'roundtable' : ccBusy() ? 'terminal' : null, queued: queued('lianyan') },
      yao: { state: yaoState, surface: diag.activeOwner === 'roundtable' ? 'roundtable' : diag.activeTurn ? 'crossing' : null, queued: queued('yao'), pendingApprovals: diag.pendingApprovals || 0 },
    }
  }

  async function subscribe(ws, after) {
    const data = await moonGet(`/roundtable/messages?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`)
    for (const message of data.messages || []) ws.send(JSON.stringify({ type: 'roundtable/message', message }))
    for (const approval of approvals.values()) ws.send(JSON.stringify({ type: 'roundtable/approval/request', ...approval }))
    ws.send(JSON.stringify({ type: 'roundtable/status', agents: await status() }))
    ws.send(JSON.stringify({ type: 'roundtable/ready', nextAfter: data.nextAfter || after || null }))
  }

  async function handleWs(ws, message) {
    const type = message?.type
    try {
      if (type === 'roundtable/subscribe') return subscribe(ws, compactText(message.after, 160))
      if (type === 'roundtable/send') {
        const cid = compactText(message.cid, 300)
        if (!cid) throw Object.assign(new Error('cid_required'), { status: 400 })
        const result = await ingest({
          from: 'aying', idempotencyKey: cid, text: message.text,
          attachments: message.attachments, replyTo: message.replyTo,
        })
        const primary = result.messages?.[0]
        ws.send(JSON.stringify({ type: 'roundtable/accepted', cid, message: primary }))
        publish(result)
        return
      }
      if (type === 'roundtable/approval/respond') {
        crossing.respondInternalApproval(message)
        return
      }
      throw Object.assign(new Error('unknown_roundtable_operation'), { status: 400 })
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'roundtable/error', cid: message?.cid || null,
        error: error.message, retryable: error.retryable === true || (Number(error.status) || 500) >= 500,
      }))
    }
  }

  async function handleHttp(req, res, url) {
    try {
      if (req.method === 'GET' && url.pathname === '/raven/roundtable/messages') {
        const suffix = `${url.searchParams.get('after') ? `&after=${encodeURIComponent(url.searchParams.get('after'))}` : ''}`
        return json(res, 200, await moonGet(`/roundtable/messages?limit=${Math.min(Number(url.searchParams.get('limit')) || 100, 200)}${suffix}`))
      }
      if (req.method === 'GET' && url.pathname === '/raven/roundtable/status') return json(res, 200, { agents: await status() })
      if (req.method === 'GET' && url.pathname === '/raven/roundtable/avatars') return json(res, 200, { avatars: await avatars() })
      if (req.method === 'PUT' && url.pathname === '/raven/roundtable/avatars') {
        const body = await readJson(req)
        const person = compactText(body.person, 20)
        if (!AVATAR_PEOPLE.has(person)) throw Object.assign(new Error('invalid_avatar_person'), { status: 400 })
        const next = await avatars()
        next[person] = safeAvatarUrl(body.url)
        await request(`/roundtable/state/${AVATAR_STATE_KEY}`, { value: JSON.stringify(next) }, 'PUT')
        broadcast({ type: 'roundtable/avatars', avatars: next })
        return json(res, 200, { avatars: next })
      }
      if (req.method === 'POST' && url.pathname === '/raven/roundtable/messages') {
        const body = await readJson(req)
        const cid = compactText(body.cid, 300)
        if (!cid) throw Object.assign(new Error('cid_required'), { status: 400 })
        const result = await ingest({ from: 'aying', idempotencyKey: cid, text: body.text, attachments: body.attachments, replyTo: body.replyTo })
        publish(result)
        return json(res, result.created ? 201 : 200, { message: result.messages?.[0], created: result.created })
      }
      if (req.method === 'POST' && url.pathname === '/raven/roundtable/say') {
        const body = await readJson(req)
        const text = compactText(body.text)
        const replyTo = compactText(body.replyTo, 160)
        if (!replyTo) throw Object.assign(new Error('replyTo_required'), { status: 400 })
        const key = compactText(body.idempotencyKey, 300) || `claude:${replyTo}:${crypto.createHash('sha256').update(text).digest('hex')}`
        const result = await ingest({ from: 'lianyan', idempotencyKey: key, text, attachments: body.attachments, replyTo })
        publish(result)
        return json(res, result.created ? 201 : 200, { message: result.messages?.[0], created: result.created })
      }
      return json(res, 404, { error: 'not_found' })
    } catch (error) {
      return json(res, Number(error.status) || 500, { error: error.message, retryable: error.retryable === true || (Number(error.status) || 500) >= 500 })
    }
  }

  function onInternalItem(event) {
    if (event.lifecycle !== 'completed') return
    const text = extractAgentText(event.item)
    if (text) finalByTurn.set(event.turnId, text)
  }

  async function onInternalCompleted(event) {
    const turnId = event.turn?.id || event.turnId
    const pending = turns.get(turnId)
    if (!pending) return
    finishing = true
    try {
      let text = finalByTurn.get(turnId) || ''
      if (!text) text = finalFromThread(await crossing.readInternalThread(pending.threadId), turnId)
      if (!text) {
        await patchDelivery(pending.deliveryId, 'blocked', { lastError: 'final_agent_message_missing' })
        return
      }
      const result = await ingest({
        from: 'yao', idempotencyKey: `codex:${pending.threadId}:${turnId}`,
        text, replyTo: pending.replyTo, attachments: [],
      })
      publish(result)
      await patchDelivery(pending.deliveryId, 'done')
    } catch (error) {
      await patchDelivery(pending.deliveryId, 'blocked', { lastError: error.message }).catch(() => {})
      logger.error('[roundtable] 曜回复入桌失败:', error.message)
    } finally {
      finishing = false
      turns.delete(turnId)
      finalByTurn.delete(turnId)
      kick()
    }
  }

  function onInternalApproval(approval) {
    approvals.set(approval.requestId, approval)
    broadcast({ type: 'roundtable/approval/request', ...approval })
  }

  function onInternalApprovalResolved(result) {
    approvals.delete(result.requestId)
    broadcast({ type: 'roundtable/approval/resolved', ...result })
  }

  const interval = options.disableTimer ? null : setInterval(() => void tick(), 15000)
  interval?.unref?.()
  if (!options.disableTimer) kick()

  return { handleWs, handleHttp, status, tick, ingest, publish, onInternalItem, onInternalCompleted, onInternalApproval, onInternalApprovalResolved, close: () => clearInterval(interval) }
}

module.exports = { createRoundtable, extractAgentText, finalFromThread }
