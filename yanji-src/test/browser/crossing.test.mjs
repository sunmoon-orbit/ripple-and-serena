import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

// This test boots the real app but cannot reach any external HTTP or WS server.
test('real components: remount/reconnect/refresh, themes/IME geometry, speech and API-call return', { timeout: 120000 }, async t => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const server = await createServer({ root, base: '/', server: { host: '127.0.0.1', port: 0, hmr: false } })
  t.after(() => server.close())
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  let ttsRequests = 0, modelRequests = 0
  let delayTts = false, failTts = false, heldTts = null
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === origin) return route.continue()
    if (url.pathname === '/tts') {
      ttsRequests++
      if (delayTts) { heldTts = route; return }
      return route.fulfill({ status: failTts ? 500 : 200, json: failTts ? { error: 'fixture failure' } : { audio: 'fixture-audio' } })
    }
    if (/chat\/completions|\/messages$|\/responses$/.test(url.pathname)) modelRequests++
    return route.fulfill({ json: [] })
  })
  // Additional safety: no native WebSocket may reach the network even if a
  // future component stops using our JS fixture.
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.addInitScript(() => {
    if (!localStorage.getItem('crossing-fixture-seeded')) {
      localStorage.setItem('crossing-fixture-seeded', 'yes')
      localStorage.setItem('yanji_navigation_v1', JSON.stringify({ panel: 'crossing', murmur: 'crossing', threadId: 'thread-luna' }))
      localStorage.setItem('llm_hub_state_v1', JSON.stringify({ moonMemory: { enabled: true, baseUrl: 'https://fixture.invalid', apiToken: 'test-only' }, timeAwareness: false, longingPush: false, proactiveCall: false }))
    }
    window.__wire = []; window.__sockets = []; window.__audios = []
    window.__thread = id => ({ id, name: `Fixture ${id}`, model: 'gpt-5.6-luna', reasoningEffort: 'low', turns: [{ id: 'old-turn', status: 'completed', items: [{ id: 'old', type: 'agentMessage', text: '完整的历史回复' }] }] })
    class FakeSocket {
      static OPEN = 1
      constructor() { this.readyState = 0; window.__sockets.push(this); setTimeout(() => { if (this.readyState === 3) return; this.readyState = 1; this.onopen?.() }, 0) }
      emit(data) { this.onmessage?.({ data: JSON.stringify(data) }) }
      send(raw) {
        const m = JSON.parse(raw); window.__wire.push(m)
        setTimeout(() => {
          if (this.readyState !== 1) return
          if (m.type === 'crossing/auth') this.emit({ type: 'crossing/authenticated' })
          if (m.type === 'crossing/thread/list') this.emit({ type: 'crossing/threads', threads: [window.__thread('thread-luna'), window.__thread('thread-two')] })
          if (m.type === 'crossing/model/list') this.emit({ type: 'crossing/models', models: [{ id: 'luna', model: 'gpt-5.6-luna', displayName: 'Luna fixture', supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low', inputModalities: ['text', 'image'], isDefault: true }] })
          if (['crossing/thread/read', 'crossing/thread/resume', 'crossing/thread/start'].includes(m.type)) this.emit({ type: 'crossing/thread', requestId: m.requestId, action: m.type.endsWith('read') ? 'read' : m.type.endsWith('start') ? 'started' : 'resumed', ready: !m.type.endsWith('read'), thread: window.__thread(m.threadId || 'new-thread') })
          if (m.type === 'crossing/turn/start') {
            this.emit({ type: 'crossing/turn/started', threadId: m.threadId, turn: { id: 'fake-turn' } })
            this.emit({ type: 'crossing/message/delta', threadId: m.threadId, turnId: 'fake-turn', itemId: 'stream', delta: 'fixture 流式回复' })
            window.__finishTurn = () => this.emit({ type: 'crossing/turn/completed', threadId: m.threadId, turn: { id: 'fake-turn', status: 'completed' } })
          }
          if (m.type === 'crossing/turn/interrupt') this.emit({ type: 'crossing/turn/completed', threadId: m.threadId, turn: { id: m.turnId, status: 'interrupted' } })
        }, 10)
      }
      close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.() }
    }
    window.WebSocket = FakeSocket
    window.Audio = class {
      constructor() { this.readyState = 1; this.duration = 2; this.played = 0; this.paused = 0; window.__audios.push(this) }
      async play() { this.played++ }
      pause() { this.paused++ }
      removeAttribute() { this.cleaned = true }
      load() {}
    }
  })
  const ready = async () => {
    try { await page.getByRole('button', { name: 'gpt-5.6-luna · low', exact: true }).waitFor({ timeout: 15000 }) }
    catch (error) {
      t.diagnostic(JSON.stringify({ errors, text: (await page.locator('body').innerText()).slice(0, 1200), wire: await page.evaluate(() => (window.__wire || []).map(m => m.type)) }))
      throw error
    }
  }
  await page.goto(origin)
  await page.locator('.home-screen').click()
  await ready()
  await page.getByRole('button', { name: 'Hollow', exact: true }).click()
  await page.getByRole('button', { name: 'Murmur', exact: true }).click()
  await ready()
  assert.equal(await page.locator('.crossing-panel').count(), 1)
  await page.reload(); await page.locator('.home-screen').click(); await ready()
  await page.evaluate(() => window.__sockets.at(-1).close())
  await page.getByText('重连中', { exact: false }).first().waitFor()
  await ready()
  assert.equal(await page.evaluate(() => window.__wire.filter(m => m.type === 'crossing/thread/resume').length), 2)

  const textarea = page.locator('.crossing-input textarea')
  const themes = ['default', 'qingwu', 'glass', 'custom', 'chensi', 'claude', 'guanduan', 'xilan']
  for (const theme of themes) {
    await page.evaluate(async theme => { const { useStore } = await import('/src/store.js'); useStore.getState().setTheme(theme) }, theme)
    for (const width of [320, 360, 412]) {
      await page.setViewportSize({ width, height: 740 })
      await textarea.fill('一行')
      await textarea.focus()
      const metrics = await textarea.evaluate(node => ({ scroll: node.scrollHeight, client: node.clientHeight, height: node.getBoundingClientRect().height, overflow: getComputedStyle(node).overflowY, before: getComputedStyle(node, '::before').content, after: getComputedStyle(node, '::after').content }))
      assert.ok(metrics.scroll <= metrics.client, `${theme}/${width}: no manufactured scrollbar`)
      assert.ok(metrics.height >= 44 && metrics.height <= 48)
      assert.equal(metrics.overflow, 'hidden')
      assert.ok(['none', 'normal'].includes(metrics.before)); assert.ok(['none', 'normal'].includes(metrics.after))
      await textarea.fill('第一行\n第二行')
      // Even with auto overflow restored, correct sizing needs no thumb.
      assert.ok(await textarea.evaluate(n => { n.style.overflowY = 'auto'; const fits = n.scrollHeight <= n.clientHeight && n.offsetWidth - n.clientWidth <= 2; n.style.overflowY = 'hidden'; return fits }), `${theme}/${width}: multiline fits without concealing overflow`)
      await textarea.fill('一行')
      assert.ok(await page.locator('.crossing-input button').evaluate(n => n.offsetWidth >= 64 && n.offsetHeight >= 44))
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.evaluate(() => { Object.defineProperty(visualViewport, 'height', { configurable: true, value: 380 }); visualViewport.dispatchEvent(new Event('resize')) })
      await page.waitForTimeout(40)
      const geometry = await page.evaluate(() => ['.crossing-panel', '.crossing-layout', '.crossing-chat', '.crossing-input', '.crossing-input textarea'].map(selector => { const n = document.querySelector(selector); const r = n.getBoundingClientRect(), s = getComputedStyle(n); return { selector, top: r.top, bottom: r.bottom, height: r.height, minHeight: s.minHeight, heightRule: s.height, viewport: s.getPropertyValue('--crossing-viewport-height') } }))
      assert.ok(geometry.at(-1).bottom <= 380, `IME visual viewport keeps composer visible: ${JSON.stringify(geometry)}`)
      await textarea.fill(Array(12).fill('长命令 /fixture/path/xxxxxxxxxxxxxxxxxxxxxxxxxxxx').join('\n'))
      assert.ok(await textarea.evaluate(n => n.offsetHeight <= 120 && getComputedStyle(n).overflowY === 'auto'))
      await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')) })
    }
  }
  // Demonstrate the pre-fix calculation produces the reported thumb.
  await textarea.fill('第一行\n第二行')
  const oldOverflow = await textarea.evaluate(n => { n.style.overflowY = 'auto'; n.style.height = 'auto'; n.style.height = `${n.scrollHeight}px`; return n.scrollHeight > n.clientHeight })
  assert.equal(oldOverflow, true)
  await textarea.fill('fixture only')
  const speaker = page.locator('.crossing-speech button').first()
  await speaker.click(); await page.getByRole('button', { name: '暂停朗读' }).waitFor()
  assert.equal(ttsRequests, 1)
  await speaker.click(); await page.getByRole('button', { name: '继续朗读' }).waitFor()
  await speaker.click(); await page.getByRole('button', { name: '暂停朗读' }).waitFor()
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const streamingSpeech = page.locator('.crossing-speech button').last()
  await streamingSpeech.waitFor()
  assert.equal(await streamingSpeech.isDisabled(), true)
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await page.waitForTimeout(40)
  assert.ok(await page.evaluate(() => window.__audios[0].cleaned))
  assert.ok(await page.evaluate(() => window.__wire.some(m => m.type === 'crossing/turn/interrupt' && m.turnId === 'fake-turn')))
  // A different fixture turn completes normally and enables speech.
  await textarea.fill('second fixture only'); await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByRole('button', { name: '停止', exact: true }).waitFor()
  await page.evaluate(() => window.__finishTurn())
  await page.waitForTimeout(40)
  assert.equal(await streamingSpeech.isDisabled(), false)
  await streamingSpeech.click(); await page.getByRole('button', { name: '暂停朗读' }).waitFor()
  await page.getByRole('button', { name: '会话', exact: true }).click()
  await page.getByRole('button', { name: /Fixture thread-two/ }).click(); await ready()
  assert.ok(await page.evaluate(() => window.__audios.at(-1).cleaned))
  // The actual React cleanup must reject a late synthesis response after unmount.
  delayTts = true
  const createdBefore = await page.evaluate(() => window.__audios.length)
  await page.locator('.crossing-speech button').first().click()
  await page.getByRole('button', { name: '取消朗读加载' }).waitFor()
  await page.getByRole('button', { name: 'Hollow', exact: true }).click()
  await page.getByRole('button', { name: 'Murmur', exact: true }).click(); await ready()
  assert.ok(heldTts)
  await heldTts.fulfill({ json: { audio: 'late-fixture-audio' } }).catch(() => {}) // aborted request
  delayTts = false
  await page.waitForTimeout(40)
  assert.equal(await page.evaluate(() => window.__audios.length), createdBefore)
  failTts = true
  await page.locator('.crossing-speech button').first().click()
  await page.getByRole('button', { name: '朗读失败，点击重试' }).waitFor()
  failTts = false
  await page.getByRole('button', { name: '朗读失败，点击重试' }).click()
  await page.getByRole('button', { name: '暂停朗读' }).waitFor()
  await page.getByRole('button', { name: '工具', exact: true }).click()
  assert.equal(await page.locator('.crossing-tool-links button').count(), 15)
  await page.getByRole('button', { name: /语音通话/ }).click()
  await page.getByRole('button', { name: '前往 Murmur', exact: true }).click()
  await page.getByRole('region', { name: 'Murmur 语音通话' }).waitFor()
  assert.ok(await page.evaluate(() => window.__audios.at(-1).cleaned), 'leaving for API call stops audio')
  assert.equal(await page.getByRole('button', { name: '拨打 Murmur 通话' }).isDisabled(), true)
  await page.getByRole('button', { name: '返回渡口', exact: true }).click(); await ready()
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('yanji_navigation_v1')).threadId), 'thread-two')
  await page.getByTitle('回到 Murmur', { exact: true }).click()
  await page.getByRole('button', { name: 'Hollow', exact: true }).click()
  await page.getByRole('button', { name: 'Murmur', exact: true }).click()
  assert.equal(await page.locator('.crossing-panel').count(), 0)
  await page.reload(); await page.locator('.home-screen').click(); await page.locator('.chat-panel').waitFor()
  assert.equal(await page.locator('.crossing-panel').count(), 0)
  assert.equal(modelRequests, 0, 'no API model call, including dialCall')
  assert.deepEqual(errors, [])
})
