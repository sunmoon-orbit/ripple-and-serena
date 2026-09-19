import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionFlow } from '../src/components/Crossing/session-flow.mjs'
import { navigate, readNavigation, writeNavigation } from '../src/components/Crossing/navigation.mjs'
import { sizeComposer } from '../src/components/Crossing/layout.mjs'
import { canReadMessage, completeTurn, threadsFromRead } from '../src/components/Crossing/messages.mjs'
import { createSpeechPlayer } from '../src/components/Chat/speech-player.mjs'
import { modelLabel } from '../src/components/Crossing/controls.mjs'

test('bottom navigation, component remount, refresh and explicit API back preserve the correct route/thread', () => {
  const storage = { data: '', getItem() { return this.data }, setItem(_, value) { this.data = value } }
  let nav = writeNavigation({ panel: 'crossing', murmur: 'crossing', threadId: 'thread-luna' }, storage)
  for (const panel of ['settings', 'memory', 'roost', 'dream', 'moments']) {
    nav = writeNavigation(navigate(nav, panel, 'bottom'), storage)
    assert.equal(nav.panel, panel, 'existing non-Murmur routes stay reachable')
    nav = navigate(readNavigation(storage), 'chat', 'bottom')
    assert.equal(nav.panel, 'crossing'); assert.equal(nav.threadId, 'thread-luna')
  }
  nav = writeNavigation(nav, storage)
  assert.equal(readNavigation(storage).panel, 'crossing')
  const mount = () => {
    const wire = []
    const flow = createSessionFlow(msg => wire.push(msg), () => {}, { threadId: readNavigation(storage).threadId, rememberThread: id => writeNavigation({ ...readNavigation(storage), threadId: id }, storage) })
    assert.equal(flow.state.thread, null)
    flow.receive({ type: 'crossing/authenticated' })
    assert.equal(wire.at(-1).type, 'crossing/thread/resume')
    assert.equal(wire.at(-1).threadId, 'thread-luna')
    assert.equal(flow.start('no turn until confirmed', 'fake'), false)
    flow.receive({ type: 'crossing/thread', requestId: wire.at(-1).requestId, action: 'resumed', ready: true, thread: { id: 'thread-luna', model: 'gpt-5.6-luna', reasoningEffort: 'low' } })
    assert.equal(modelLabel(flow.state.thread), 'gpt-5.6-luna · low')
    return { flow, wire }
  }
  const first = mount(); first.flow.disconnect()
  const second = mount() // new component instance, not reusing React memory
  second.flow.disconnect(); second.flow.receive({ type: 'crossing/authenticated' })
  assert.equal(second.wire.at(-1).threadId, 'thread-luna')
  writeNavigation(navigate(nav, 'chat', 'api-back'), storage)
  assert.equal(navigate(readNavigation(storage), 'chat', 'bottom').panel, 'chat')
  assert.equal(readNavigation(storage).threadId, 'thread-luna')
})

test('pending model is never promoted to confirmed by persistence or resume', () => {
  const wire = []
  const flow = createSessionFlow(m => wire.push(m), () => {}, { threadId: 't' })
  flow.receive({ type: 'crossing/authenticated' })
  flow.receive({ type: 'crossing/thread', requestId: wire.at(-1).requestId, action: 'resumed', ready: true, thread: { id: 't', model: null }, pendingModel: { model: 'gpt-5.6-luna', effort: 'low' } })
  assert.equal(modelLabel(flow.state.thread), '尚未确认模型')
  assert.equal(flow.state.pendingModel.model, 'gpt-5.6-luna')
})

test('call entry routes to API without discarding Crossing return location', () => {
  const nav = navigate({ panel: 'crossing', murmur: 'crossing', threadId: 't' }, 'chat', 'api-call')
  assert.equal(nav.panel, 'chat'); assert.equal(nav.callFromCrossing, true)
  assert.equal(nav.murmur, 'crossing')
  assert.equal(navigate(nav, 'crossing').threadId, 't')
  assert.equal(navigate(nav, 'crossing').callFromCrossing, false)
  assert.equal(navigate(nav, 'chat', 'bottom').panel, 'crossing')
})

test('composer includes borders, rounds fractional pixels and scrolls only after reaching cap', () => {
  const node = { style: {}, scrollHeight: 43 }
  sizeComposer(node, { borderTopWidth: '1px', borderBottomWidth: '1px', maxHeight: '120px' })
  assert.equal(node.style.height, '46px'); assert.equal(node.style.overflowY, 'hidden')
  node.scrollHeight = 117
  sizeComposer(node, { borderTopWidth: '.8px', borderBottomWidth: '.8px', maxHeight: '120px' })
  assert.equal(node.style.height, '120px'); assert.equal(node.style.overflowY, 'hidden')
  node.scrollHeight = 400
  sizeComposer(node, { borderTopWidth: '1px', borderBottomWidth: '1px', maxHeight: '120px' })
  assert.equal(node.style.height, '120px'); assert.equal(node.style.overflowY, 'auto')
})

test('only completed assistant messages can speak; interrupted and still streaming messages cannot', () => {
  const message = { id: 'm', turnId: 't', role: 'assistant', text: 'fixture', streaming: true }
  assert.equal(canReadMessage(message), false)
  assert.equal(canReadMessage({ ...message, streaming: false }), false) // item completed, turn still running
  assert.equal(canReadMessage(completeTurn([message], { id: 't', status: 'interrupted' })[0]), false)
  assert.equal(canReadMessage(completeTurn([message], { id: 't', status: 'completed' })[0]), true)
  const history = threadsFromRead({ turns: [{ id: 't', status: 'completed', items: [{ id: 'm', type: 'agentMessage', text: 'fixture history' }] }] })
  assert.equal(canReadMessage(history[0]), true)
  assert.equal(canReadMessage({ ...history[0], role: 'user' }), false)
})

function audioFixture() {
  return { readyState: 1, duration: 3, played: 0, paused: 0, removed: false,
    async play() { this.played++ }, pause() { this.paused++ }, removeAttribute() { this.removed = true }, load() {} }
}
test('TTS uses fake synthesis, play/pause/resume and cleanup; another bubble stops the first', async () => {
  const audio = audioFixture(); let requests = 0
  const p = createSpeechPlayer({ synthesize: async () => { requests++; return { audio: 'fixture' } }, createAudio: () => audio })
  await p.toggle(); assert.equal(p.state.status, 'playing')
  await p.toggle(); assert.equal(p.state.status, 'paused')
  await p.toggle(); assert.equal(p.state.status, 'playing'); assert.equal(requests, 1)
  const q = createSpeechPlayer({ synthesize: async () => ({ audio: 'fixture' }), createAudio: audioFixture })
  await q.toggle(); assert.equal(p.state.status, 'idle'); assert.equal(audio.removed, true)
  q.stop(); assert.equal(q.state.status, 'idle')
})

test('switch thread/unmount/stop during delayed synthesis aborts and never plays late audio', async () => {
  for (const action of ['thread switch', 'unmount', 'stop', 'disconnect']) {
    let finish, signal, created = 0
    const p = createSpeechPlayer({ synthesize: s => { signal = s; return new Promise(resolve => { finish = resolve }) }, createAudio: () => { created++; return audioFixture() } })
    const pending = p.toggle(); assert.equal(p.state.status, 'loading', action)
    p.stop(); assert.equal(signal.aborted, true)
    finish({ audio: 'late' }); await pending
    assert.equal(created, 0); assert.equal(p.state.status, 'idle')
  }
})

test('metadata load cancellation and synthesis failure are cleaned and retryable', async () => {
  const audio = audioFixture(); audio.readyState = 0
  const p = createSpeechPlayer({ synthesize: async () => ({ audio: 'fake' }), createAudio: () => audio })
  const pending = p.toggle(); await Promise.resolve(); p.stop(); await pending
  assert.equal(audio.removed, true)
  let fails = true
  const q = createSpeechPlayer({ synthesize: async () => { if (fails) throw Error('private server error must not reach UI'); return { audio: 'fake' } }, createAudio: audioFixture })
  await q.toggle(); assert.equal(q.state.status, 'error'); assert.equal(q.state.error, '朗读失败，请重试')
  fails = false; await q.toggle(); assert.equal(q.state.status, 'playing'); q.stop()
})
