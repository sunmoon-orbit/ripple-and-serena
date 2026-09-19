import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

test('one global player survives panels and supports manual/model sharing in Murmur and Agent', { timeout: 120000 }, async t => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const server = await createServer({ root, base: '/', server: { host: '127.0.0.1', port: 0, hmr: false } })
  t.after(() => server.close())
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
  const modelBodies = []

  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin) return route.continue()
    if (url.hostname === 'music-api.gdstudio.xyz') {
      const type = url.searchParams.get('types')
      const query = url.searchParams.get('name') || ''
      if (type === 'search') {
        const agent = query.includes('Agent')
        const model = query.includes('Fixture Song')
        const name = agent ? 'Agent Song' : model ? 'Fixture Song' : 'Manual Song'
        const artist = agent ? 'Agent Artist' : model ? 'Fixture Singer' : 'Manual Artist'
        const id = agent ? 'agent-1' : model ? 'model-1' : 'manual-1'
        return route.fulfill({ json: [{ name, artist: [artist], id, url_id: id, pic_id: `pic-${id}`, lyric_id: `lyric-${id}` }] })
      }
      if (type === 'url') return route.fulfill({ json: { url: `https://audio.fixture/${url.searchParams.get('id')}.mp3` } })
      if (type === 'pic') return route.fulfill({ json: { url: `https://image.fixture/${url.searchParams.get('id')}.jpg` } })
      if (type === 'lyric') return route.fulfill({ json: { lyric: '[00:01.00]fixture lyric' } })
    }
    if (url.hostname === 'llm.fixture' && url.pathname.endsWith('/chat/completions')) {
      modelBodies.push(request.postDataJSON())
      const body = [
        'data: {"choices":[{"delta":{"content":"收到这首歌"},"finish_reason":null}]}',
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n')
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body })
    }
    return route.fulfill({ status: 200, json: [] })
  })
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.addInitScript(() => {
    localStorage.setItem('yanji_navigation_v1', JSON.stringify({ panel: 'chat', murmur: 'chat', threadId: 'fixture-thread' }))
    window.__musicAudios = []
    window.__agentWire = []
    const NativeAudio = window.Audio
    window.Audio = function FixtureAudio() {
      const node = document.createElement('audio')
      let paused = true
      let currentTime = 0
      Object.defineProperty(node, 'paused', { configurable: true, get: () => paused })
      Object.defineProperty(node, 'currentTime', { configurable: true, get: () => currentTime, set: value => { currentTime = Number(value) || 0; node.dispatchEvent(new Event('timeupdate')) } })
      Object.defineProperty(node, 'duration', { configurable: true, get: () => 180 })
      node.play = async () => { paused = false; node.dispatchEvent(new Event('play')) }
      node.pause = () => { paused = true; node.dispatchEvent(new Event('pause')) }
      node.load = () => {}
      window.__musicAudios.push(node)
      return node
    }
    window.Audio.prototype = NativeAudio.prototype
    class FixtureSocket {
      static OPEN = 1
      constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
      emit(value) { this.onmessage?.({ data: JSON.stringify(value) }) }
      send(raw) {
        const msg = JSON.parse(raw)
        window.__agentWire.push(msg)
        setTimeout(() => {
          if (msg.type === 'crossing/auth') this.emit({ type: 'crossing/authenticated', capability: 'fixture-capability', expiresAt: Date.now() + 60000 })
          if (msg.type === 'crossing/thread/list') this.emit({ type: 'crossing/threads', threads: [{ id: 'fixture-thread', name: 'Fixture agent', model: 'fixture-model', reasoningEffort: 'low', turns: [] }] })
          if (msg.type === 'crossing/model/list') this.emit({ type: 'crossing/models', models: [{ model: 'fixture-model', displayName: 'Fixture', supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low', isDefault: true, inputModalities: ['text'] }] })
          if (msg.type === 'crossing/thread/resume') this.emit({ type: 'crossing/thread', requestId: msg.requestId, action: 'resumed', ready: true, thread: { id: 'fixture-thread', name: 'Fixture agent', model: 'fixture-model', reasoningEffort: 'low', turns: [] } })
          if (msg.type === 'crossing/turn/start') this.emit({ type: 'crossing/turn/started', threadId: msg.threadId, turn: { id: 'fixture-turn' } })
        }, 5)
      }
      close() { this.readyState = 3; this.onclose?.() }
    }
    window.WebSocket = FixtureSocket
  })

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin)
  await page.locator('.home-screen').click()
  await page.evaluate(async () => {
    const { useStore } = await import('/src/store.js')
    const connection = { id: 'fixture-connection', name: 'Fixture', provider: 'openai', baseUrl: 'https://llm.fixture', apiKey: 'test-only', defaultModel: 'fixture-model' }
    const chat = { id: 'fixture-chat', title: 'Fixture chat', connectionId: connection.id, model: connection.defaultModel, createdAt: Date.now(), updatedAt: Date.now() }
    useStore.setState({
      activePanel: 'chat', connections: [connection], activeConnectionId: connection.id,
      chats: [chat], activeChatId: chat.id, messagesByChatId: { [chat.id]: [] }, bigReady: true,
      autoTools: false, replyDelay: 'off', moonMemory: { enabled: true, baseUrl: 'https://memory.fixture', apiToken: 'fixture-token', limit: 5 },
    })
    useStore.getState().addMessage(chat.id, { role: 'assistant', content: '[music:Fixture Song|Fixture Singer|fixture model pick]' })
  })
  const modelCard = page.locator('.music-card').filter({ hasText: 'Fixture Song' })
  await modelCard.waitFor()
  await modelCard.getByRole('button', { name: '播放' }).click()
  await page.locator('.mini-player').waitFor()
  assert.equal(await page.evaluate(() => window.__musicAudios.length), 1, 'model pick creates the only Audio')
  const firstSrc = await page.evaluate(() => window.__musicAudios[0].src)

  for (const panel of ['roost', 'chat', 'memory', 'crossing', 'chat']) {
    await page.evaluate(async value => { const { useStore } = await import('/src/store.js'); useStore.getState().setActivePanel(value) }, panel)
    await page.locator('.mini-player').waitFor()
    assert.equal(await page.evaluate(() => window.__musicAudios.length), 1, `${panel} keeps one Audio`)
    assert.equal(await page.evaluate(() => window.__musicAudios[0].src), firstSrc, `${panel} keeps the current source`)
  }
  await page.evaluate(async () => { const { useStore } = await import('/src/store.js'); useStore.getState().setActivePanel('roost') })
  await page.getByText('书架', { exact: true }).click()
  await page.locator('.roost-overlay').waitFor()
  assert.equal(await page.evaluate(() => window.__musicAudios.length), 1, 'reading fixture keeps music')
  await page.evaluate(async () => { const { useStore } = await import('/src/store.js'); useStore.getState().setActivePanel('chat') })

  const geometry = await page.evaluate(() => {
    const mini = document.querySelector('.mini-player').getBoundingClientRect()
    const nav = document.querySelector('.icon-nav').getBoundingClientRect()
    return { miniBottom: mini.bottom, navTop: nav.top }
  })
  assert.ok(geometry.miniBottom <= geometry.navTop + 1, JSON.stringify(geometry))
  await page.evaluate(() => { Object.defineProperty(visualViewport, 'height', { configurable: true, value: 400 }); visualViewport.dispatchEvent(new Event('resize')) })
  assert.equal(await page.locator('.mini-player').evaluate(node => getComputedStyle(node).display), 'none')
  await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')) })

  await page.locator('.mp-info').click()
  await page.locator('.mp-full').waitFor()
  await page.getByRole('button', { name: '收起播放器' }).click()
  await page.locator('.mp-full').waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => window.__musicAudios[0].paused), false, 'collapse does not pause')

  await page.locator('.mp-info').click()
  await page.getByRole('button', { name: '选歌' }).click()
  await page.getByRole('textbox', { name: '歌名或歌手' }).fill('Manual')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.getByText('Manual Song', { exact: true }).waitFor()
  await page.getByRole('button', { name: '播放 Manual Song' }).click()
  await page.getByText('Manual Song', { exact: true }).first().waitFor()
  assert.equal(await page.evaluate(() => window.__musicAudios.length), 1, 'manual pick reuses the Audio')

  await page.getByRole('button', { name: '选歌' }).click()
  await page.getByRole('textbox', { name: '歌名或歌手' }).fill('Manual')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.getByRole('button', { name: '点给 TA Manual Song' }).click()
  await page.locator('.music-share-card').filter({ hasText: 'Manual Song' }).waitFor()
  await page.waitForFunction(() => document.body.innerText.includes('收到这首歌'))
  const murmurContext = modelBodies.at(-1).messages.find(message => message.role === 'user').content
  assert.match(murmurContext, /【用户主动点歌】/)
  assert.match(murmurContext, /netease:manual-1/)
  assert.match(murmurContext, /pic-manual-1\.jpg/)

  await page.getByRole('button', { name: '收起播放器' }).click()
  await page.evaluate(async () => { const { useStore } = await import('/src/store.js'); useStore.getState().setActivePanel('crossing') })
  await page.locator('.crossing-panel').waitFor()
  await page.locator('.crossing-input textarea').waitFor({ state: 'visible' })
  await page.locator('.mp-info').click()
  await page.getByRole('button', { name: '选歌' }).click()
  await page.getByRole('textbox', { name: '歌名或歌手' }).fill('Agent')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.getByRole('button', { name: '点给 TA Agent Song' }).click()
  await page.waitForFunction(() => window.__agentWire.some(msg => msg.type === 'crossing/turn/start' && msg.text.includes('【用户主动点歌】')))
  const agentTurn = await page.evaluate(() => window.__agentWire.findLast(msg => msg.type === 'crossing/turn/start'))
  assert.match(agentTurn.text, /Agent Song/)
  assert.match(agentTurn.text, /netease:agent-1/)
  assert.equal(await page.locator('.music-share-card').filter({ hasText: 'Agent Song' }).count(), 1)

  await page.getByRole('button', { name: '收起播放器' }).click()
  await page.locator('.mp-btn.mp-close').click()
  await page.locator('.mini-player').waitFor({ state: 'hidden' })
  const closed = await page.evaluate(async () => { const player = await import('/src/utils/player.js'); return player.getState() })
  assert.equal(closed.track, null)
  assert.deepEqual(closed.queue, [])
  assert.equal(await page.evaluate(() => window.__musicAudios.length), 1)
  assert.deepEqual(errors, [])
})
