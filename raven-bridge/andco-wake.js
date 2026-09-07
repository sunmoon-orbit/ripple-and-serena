const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  serverId: '',
  wakeToolName: '',
  aiIdentityId: '',
  roomId: '',
  chatId: '',
  cooldownSeconds: 30,
  queueLimit: 10,
  dailyWakeLimit: 20,
  dailyCostLimitCents: 200,
  estimatedCostCents: 5,
})

function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10)
}

function cleanError(error) {
  const message = String(error?.message || error || '处理失败')
  if (/token|secret|authorization|bearer|api.?key/i.test(message)) return '外部服务认证失败'
  return message.replace(/https?:\/\/\S+/g, '[地址已隐藏]').slice(0, 160)
}

function normalizeMentionIds(mentions) {
  return (Array.isArray(mentions) ? mentions : []).map((item) => (
    typeof item === 'string' ? item : item?.id
  )).filter(Boolean).map(String)
}

function isDirected(event, aiIdentityId) {
  const target = String(aiIdentityId || '')
  if (!target) return false
  if (normalizeMentionIds(event.mentions).includes(target)) return true
  if (String(event.replyToAiId || event.reply_to_ai_id || '') === target) return true
  if (normalizeMentionIds(event.directedTo || event.directed_to).includes(target)) return true
  return event.type === 'directed' && String(event.targetAiId || event.target_ai_id || '') === target
}

function sanitizeConfig(input, previous = DEFAULT_CONFIG) {
  const merged = { ...previous, ...(input || {}) }
  return {
    enabled: merged.enabled === true,
    serverId: String(merged.serverId || '').slice(0, 120),
    wakeToolName: String(merged.wakeToolName || '').slice(0, 160),
    aiIdentityId: String(merged.aiIdentityId || '').slice(0, 200),
    roomId: String(merged.roomId || '').slice(0, 200),
    chatId: String(merged.chatId || '').slice(0, 200),
    cooldownSeconds: Math.min(3600, Math.max(5, Number(merged.cooldownSeconds) || 30)),
    queueLimit: Math.min(50, Math.max(1, Number(merged.queueLimit) || 10)),
    dailyWakeLimit: Math.min(200, Math.max(1, Number(merged.dailyWakeLimit) || 20)),
    dailyCostLimitCents: Math.min(100000, Math.max(1, Number(merged.dailyCostLimitCents) || 200)),
    estimatedCostCents: Math.min(10000, Math.max(1, Number(merged.estimatedCostCents) || 5)),
  }
}

function createAndcoWake({ state, save, deliver, now = () => Date.now() }) {
  state.config = sanitizeConfig(state.config)
  state.seen = Array.isArray(state.seen) ? state.seen.slice(-2000) : []
  state.queue = Array.isArray(state.queue) ? state.queue : []
  state.recent = Array.isArray(state.recent) ? state.recent.slice(-20) : []
  state.daily = state.daily && typeof state.daily === 'object' ? state.daily : { day: dayKey(now()), count: 0, reservedCents: 0 }
  state.errorStopped = !!state.errorStopped
  let running = false
  let abortController = null

  const persist = () => save?.()
  const addRecent = (entry) => {
    state.recent = [...state.recent, { at: new Date(now()).toISOString(), ...entry }].slice(-20)
  }
  const resetDaily = () => {
    const today = dayKey(now())
    if (state.daily.day !== today) state.daily = { day: today, count: 0, reservedCents: 0 }
  }
  const prerequisites = (servers) => {
    const cfg = state.config
    const server = (servers || []).find((item) => item.id === cfg.serverId)
    const tool = server?.tools?.find((item) => item.name === cfg.wakeToolName)
    return !!(cfg.enabled && server?.enabled !== false && tool?.enabled === true && cfg.aiIdentityId && cfg.roomId && cfg.chatId)
  }

  async function drain(servers) {
    if (running || state.errorStopped || !prerequisites(servers)) return
    running = true
    try {
      while (state.queue.length && prerequisites(servers) && !state.errorStopped) {
        const event = state.queue.shift()
        abortController = new AbortController()
        persist()
        try {
          await deliver(event, { signal: abortController.signal, chatId: state.config.chatId })
          addRecent({ eventId: event.id, roomId: event.roomId, source: 'AndCo', result: '已投递' })
        } catch (error) {
          if (abortController.signal.aborted) {
            addRecent({ eventId: event.id, roomId: event.roomId, source: 'AndCo', result: '已停止' })
          } else {
            state.errorStopped = true
            addRecent({ eventId: event.id, roomId: event.roomId, source: 'AndCo', result: '失败', error: cleanError(error) })
          }
        } finally {
          abortController = null
          persist()
        }
      }
    } finally {
      running = false
    }
  }

  function updateConfig(patch, servers) {
    state.config = sanitizeConfig(patch, state.config)
    state.errorStopped = false
    if (!prerequisites(servers)) {
      state.queue = []
      abortController?.abort()
    }
    persist()
    if (prerequisites(servers)) void drain(servers)
    return status(servers)
  }

  function ingest(input, servers) {
    const event = input && typeof input === 'object' ? input : {}
    if (!prerequisites(servers) || state.errorStopped) return { accepted: false, reason: 'disabled' }
    const id = String(event.id || event.eventId || '')
    const roomId = String(event.roomId || event.room_id || '')
    const targetAiId = String(event.targetAiId || event.target_ai_id || '')
    if (!id) return { accepted: false, reason: 'missing_event_id' }
    if (state.seen.includes(id)) return { accepted: false, reason: 'duplicate' }
    if (roomId !== state.config.roomId || targetAiId !== state.config.aiIdentityId) return { accepted: false, reason: 'scope_mismatch' }
    if (!isDirected(event, state.config.aiIdentityId)) return { accepted: false, reason: 'not_directed' }
    const content = String(event.content || '').trim().slice(0, 8000)
    if (!content) return { accepted: false, reason: 'empty' }

    state.seen = [...state.seen, id].slice(-2000)
    resetDaily()
    const cooldownMs = state.config.cooldownSeconds * 1000
    if (state.lastAcceptedAt && now() - state.lastAcceptedAt < cooldownMs) {
      addRecent({ eventId: id, roomId, source: 'AndCo', result: '冷却中，已忽略' })
      persist()
      return { accepted: false, reason: 'cooldown' }
    }
    if (state.daily.count >= state.config.dailyWakeLimit ||
        state.daily.reservedCents + state.config.estimatedCostCents > state.config.dailyCostLimitCents) {
      addRecent({ eventId: id, roomId, source: 'AndCo', result: '今日保护上限，已忽略' })
      persist()
      return { accepted: false, reason: 'daily_limit' }
    }
    if (state.queue.length >= state.config.queueLimit) {
      addRecent({ eventId: id, roomId, source: 'AndCo', result: '队列已满，已忽略' })
      persist()
      return { accepted: false, reason: 'queue_full' }
    }
    state.lastAcceptedAt = now()
    state.daily.count += 1
    state.daily.reservedCents += state.config.estimatedCostCents
    state.queue.push({ id, roomId, targetAiId, content, createdAt: String(event.createdAt || event.created_at || '') })
    persist()
    void drain(servers)
    return { accepted: true }
  }

  function status(servers) {
    resetDaily()
    return {
      config: { ...state.config },
      active: prerequisites(servers) && !state.errorStopped,
      errorStopped: state.errorStopped,
      queueSize: state.queue.length,
      daily: { ...state.daily },
      recent: state.recent.slice().reverse(),
    }
  }

  return { drain, ingest, isDirected, status, updateConfig }
}

module.exports = { DEFAULT_CONFIG, cleanError, createAndcoWake, isDirected, sanitizeConfig }
