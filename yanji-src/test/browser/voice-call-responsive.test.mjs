import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const sizes = [
  { width: 320, height: 568, label: 'small portrait' },
  { width: 360, height: 740, label: 'regular portrait' },
  { width: 412, height: 915, label: 'tall portrait' },
  { width: 844, height: 390, label: 'landscape' },
]

test('voice call keeps transcript and controls inside the visual viewport', { timeout: 120000 }, async t => {
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
  page.on('pageerror', error => errors.push(error.message))

  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === origin) return route.continue()
    return route.fulfill({ status: 503, json: { error: 'fixture blocks external calls' } })
  })
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.addInitScript(() => {
    localStorage.setItem('yanji_navigation_v1', JSON.stringify({ panel: 'chat', murmur: 'chat' }))
    localStorage.setItem('llm_hub_state_v1', JSON.stringify({
      moonMemory: { enabled: true, baseUrl: 'https://fixture.invalid', apiToken: 'fixture-only' },
      timeAwareness: false,
      longingPush: false,
      proactiveCall: false,
      voiceCallStyle: 'soft',
    }))
  })

  await page.goto(origin)
  await page.locator('.home-screen').click()
  await page.locator('.roost-panel').waitFor()
  await page.evaluate(async () => { const { useStore } = await import('/src/store.js'); useStore.getState().setActivePanel('chat') })
  await page.locator('.chat-panel').waitFor()
  await page.getByTitle('对话列表').click()
  await page.getByRole('button', { name: '语音通话', exact: true }).click()
  await page.locator('.vc-overlay').waitFor()

  const longText = Array(18).fill('这是一段用于验证长字幕局部滚动、不会挤走底部通话控制区的静态测试文字。').join('')
  // Keep this a static visual fixture: no model/TTS/STT call is needed to stress the transcript.
  await page.locator('.vcs-quote').evaluate((node, text) => { node.textContent = text }, longText)

  const geometry = async label => {
    const result = await page.evaluate(() => {
      const rect = selector => {
        const node = document.querySelector(selector)
        const r = node.getBoundingClientRect()
        return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height }
      }
      return {
        viewport: { width: innerWidth, height: innerHeight },
        overlay: rect('.vc-overlay'),
        container: rect('.vc-container'),
        avatar: rect('.vcs-avatar'),
        quote: rect('.vcs-quote'),
        quoteScrolls: document.querySelector('.vcs-quote').scrollHeight > document.querySelector('.vcs-quote').clientHeight,
        controls: rect('.vc-controls'),
        buttons: [...document.querySelectorAll('.vc-controls button')].map(node => {
          const r = node.getBoundingClientRect()
          return { title: node.title, top: r.top, right: r.right, bottom: r.bottom, left: r.left }
        }),
        pageWidth: document.documentElement.scrollWidth,
      }
    })
    assert.ok(result.overlay.bottom <= result.viewport.height + 1, `${label}: overlay bottom ${JSON.stringify(result)}`)
    assert.ok(result.container.bottom <= result.overlay.bottom + 1, `${label}: container bottom`)
    assert.ok(result.controls.top >= result.overlay.top && result.controls.bottom <= result.overlay.bottom + 1, `${label}: controls visible`)
    assert.equal(result.buttons.length, 4, `${label}: all controls present`)
    for (const button of result.buttons) {
      assert.ok(button.left >= -1 && button.right <= result.viewport.width + 1, `${label}: ${button.title} horizontal`)
      assert.ok(button.top >= result.overlay.top - 1 && button.bottom <= result.overlay.bottom + 1, `${label}: ${button.title} vertical`)
    }
    assert.ok(result.avatar.width >= 72 && result.avatar.width <= 136, `${label}: responsive avatar ${result.avatar.width}`)
    assert.ok(result.quote.height >= 0 && result.quote.bottom <= result.controls.top, `${label}: transcript yields to controls`)
    assert.ok(result.pageWidth <= result.viewport.width, `${label}: no page overflow`)
    return result
  }

  let small
  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height })
    const result = await geometry(size.label)
    if (size.width === 320) small = result
  }
  assert.equal(small.quoteScrolls, true, 'long transcript scrolls locally on the shortest portrait')

  // Shared responsive foundation: crow and duo retain the same reachable bottom controls.
  for (const style of ['crow', 'duo', 'soft']) {
    await page.evaluate(async style => {
      const { useStore } = await import('/src/store.js')
      useStore.getState().setVoiceCallStyle(style)
    }, style)
    await page.waitForFunction(style => {
      const overlay = document.querySelector('.vc-overlay')
      if (!overlay) return false
      if (style === 'crow') return !overlay.classList.contains('vc-soft') && !overlay.classList.contains('vc-duo')
      return overlay.classList.contains(`vc-${style}`)
    }, style)
    await page.setViewportSize({ width: 320, height: 568 })
    const shared = await page.evaluate(() => {
      const overlay = document.querySelector('.vc-overlay').getBoundingClientRect()
      const controls = document.querySelector('.vc-controls').getBoundingClientRect()
      return { overlay: { top: overlay.top, bottom: overlay.bottom }, controls: { top: controls.top, bottom: controls.bottom } }
    })
    assert.ok(shared.controls.top >= shared.overlay.top && shared.controls.bottom <= shared.overlay.bottom + 1, `${style}: shared controls stay reachable ${JSON.stringify(shared)}`)
  }

  // Simulate Android Chrome shrinking only visualViewport while the IME is open.
  await page.evaluate(async () => {
    const { useStore } = await import('/src/store.js')
    useStore.getState().setVoiceCallStyle('soft')
  })
  await page.setViewportSize({ width: 360, height: 740 })
  await page.getByTitle('打字说').click()
  await page.locator('.vc-type-input').waitFor()
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 360 })
    visualViewport.dispatchEvent(new Event('resize'))
  })
  await page.waitForTimeout(40)
  const ime = await page.evaluate(() => {
    const overlay = document.querySelector('.vc-overlay').getBoundingClientRect()
    const input = document.querySelector('.vc-type-input').getBoundingClientRect()
    const controls = document.querySelector('.vc-controls').getBoundingClientRect()
    return { overlay: { top: overlay.top, bottom: overlay.bottom, height: overlay.height }, input: { bottom: input.bottom }, controls: { bottom: controls.bottom } }
  })
  assert.ok(ime.overlay.height <= 361 && ime.overlay.bottom <= 361, `IME uses visual viewport: ${JSON.stringify(ime)}`)
  assert.ok(ime.input.bottom <= ime.overlay.bottom && ime.controls.bottom <= ime.overlay.bottom, `IME keeps input and controls visible: ${JSON.stringify(ime)}`)
  assert.deepEqual(errors, [])
})
