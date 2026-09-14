// Transport-independent session state, shared by the React view and wire tests.
export function createSessionFlow(send, changed = () => {}) {
  let state = { authenticated: false, phase: 'disconnected', thread: null, error: '' }
  let sequence = 0
  let pending = null
  let remembered = ''
  const update = (patch) => { state = { ...state, ...patch }; changed(state) }
  const request = (type, threadId) => {
    pending = { requestId: `session-${++sequence}`, type, threadId }
    update({ phase: 'loading', error: '' })
    send({ ...pending })
  }
  const flow = {
    get state() { return state },
    create() { if (state.authenticated && state.phase !== 'loading') request('crossing/thread/start') },
    select(id) { if (id && state.authenticated && state.phase !== 'loading') request('crossing/thread/read', id) },
    disconnect() { pending = null; update({ authenticated: false, phase: 'disconnected' }) },
    receive(msg) {
      if (msg.type === 'crossing/authenticated') {
        update({ authenticated: true, phase: 'empty', error: '' })
        send({ type: 'crossing/thread/list' })
        send({ type: 'crossing/usage/read' })
        if (remembered) request('crossing/thread/resume', remembered)
      }
      if (msg.type === 'crossing/status' && ['offline', 'error'].includes(msg.state)) {
        pending = null
        update({ phase: 'empty', error: msg.error || 'Codex 已离线，请重新选择会话' })
      }
      if (msg.type === 'crossing/error' && pending && msg.requestId === pending.requestId) {
        pending = null
        update({ phase: 'empty', error: msg.error || '会话操作失败' })
      }
      if (msg.type !== 'crossing/thread' || !pending || msg.requestId !== pending.requestId) return
      if (!msg.thread?.id || (pending.threadId && msg.thread.id !== pending.threadId)) {
        pending = null; update({ phase: 'empty', error: '服务返回了无效会话' }); return
      }
      if (msg.action === 'read') {
        // Reading history alone does not load the model runtime for this thread.
        request('crossing/thread/resume', msg.thread.id)
        return
      }
      if (!msg.ready || !['started', 'resumed'].includes(msg.action)) return
      remembered = msg.thread.id
      pending = null
      update({ phase: 'ready', thread: msg.thread, error: '' })
      send({ type: 'crossing/thread/list' })
    },
    start(text, clientMessageId) {
      if (!state.authenticated || state.phase !== 'ready' || !state.thread?.id || !text.trim()) return false
      send({ type: 'crossing/turn/start', threadId: state.thread.id, text, clientMessageId })
      return true
    },
  }
  return flow
}
