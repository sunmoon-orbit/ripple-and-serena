import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

test('locked first paint, verified unlock, logout/change/failure, settings target and reconnect', { timeout: 90000 }, async t => {
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), base: '/', server: { host: '127.0.0.1', port: 0, hmr: false } })
  t.after(() => server.close()); await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, serviceWorkers: 'block' })
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.fulfill({ status: 401, json: { error: 'unauthorized' } }))
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.addInitScript(() => {
    localStorage.setItem('yanji_navigation_v1', JSON.stringify({ panel: 'crossing', murmur: 'crossing', threadId: '' }))
    window.__wireTypes = []; window.__sockets = []
    class FixtureSocket {
      static OPEN = 1
      constructor() { this.readyState = 0; window.__sockets.push(this); setTimeout(() => { if (this.readyState === 3) return; this.readyState = 1; this.onopen?.() }, 0) }
      emit(value) { this.onmessage?.({ data: JSON.stringify(value) }) }
      send(raw) {
        const m = JSON.parse(raw); window.__wireTypes.push(m.type)
        if (m.type === 'crossing/auth') setTimeout(() => {
          if (this.readyState !== 1) return
          this.emit(m.token === 'fixture-valid' && m.enabled === true
            ? { type: 'crossing/authenticated', capability: 'fixture-capability', expiresAt: Date.now() + 60000 }
            : { type: 'crossing/auth_failed' })
        }, 150)
      }
      close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.() }
    }
    window.WebSocket = FixtureSocket
  })
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  const change = config => page.evaluate(async value => { const { useStore } = await import('/src/store.js'); useStore.getState().setMoonMemory(value) }, config)
  const enter = () => page.evaluate(async () => { const { useStore } = await import('/src/store.js'); useStore.getState().setActivePanel('crossing') })
  const locked = () => page.getByText('渡口已锁定', { exact: true }).waitFor()
  const ready = async () => {
    try { await page.getByText('Codex · 请选择或新建会话', { exact: true }).waitFor({ timeout: 7000 }) }
    catch (error) { t.diagnostic(JSON.stringify({ errors, wire: await page.evaluate(() => window.__wireTypes), text: (await page.locator('body').innerText()).slice(0, 800) })); throw error }
  }
  await page.goto(origin); await page.locator('.home-screen').click(); await page.locator('.roost-panel').waitFor(); await enter(); await locked()
  assert.equal(await page.evaluate(() => window.__wireTypes.filter(type => String(type).startsWith('crossing/')).length), 0)
  await page.getByRole('button', { name: '前往设置', exact: true }).click()
  assert.equal(await page.evaluate(async () => { const { useStore } = await import('/src/store.js'); return useStore.getState().navigation.settingsSection }), 'moon')
  await page.getByRole('button', { name: '测试连接', exact: true }).waitFor()
  await change({ enabled: true, baseUrl: 'https://fixture.invalid', apiToken: 'fixture-wrong' }); await enter(); await locked()
  await page.waitForTimeout(250)
  assert.deepEqual(await page.evaluate(() => window.__wireTypes.filter(type => String(type).startsWith('crossing/'))), ['crossing/auth'])
  await change({ apiToken: 'fixture-valid' }); await locked(); await ready()
  assert.ok(await page.evaluate(() => window.__wireTypes.includes('crossing/model/list')))
  assert.equal(await page.evaluate(() => location.href.includes('fixture-valid')), false)
  assert.equal((await page.locator('body').innerText()).includes('fixture-valid'), false)
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('fixture-capability')), false)
  await page.evaluate(() => window.__sockets.at(-1).close()); await locked(); await ready()
  await change({ apiToken: '' }); await locked()
  await change({ apiToken: 'fixture-valid' }); await ready()
  await page.evaluate(async () => { const { useStore } = await import('/src/store.js'); useStore.getState().setAgentBlocked(true) }); await locked()
  await page.reload(); await page.locator('.home-screen').click(); await page.locator('.roost-panel').waitFor(); await enter(); await ready()
  await page.evaluate(() => window.__sockets.at(-1).emit({ type: 'crossing/auth_failed' })); await locked()
  assert.deepEqual(errors, [])
})
