import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

test('归巢聊天栏移除重复语音入口，电话页保留完整控件', { timeout: 60000 }, async t => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const server = await createServer({ root, base: '/', server: { host: '127.0.0.1', port: 0, hmr: false } })
  t.after(() => server.close())
  await server.listen()

  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.origin === origin ? route.continue() : route.abort()
  })

  const page = await context.newPage()
  await page.goto(origin + '/raven/index.html')
  assert.equal(await page.locator('#mic-btn, #bilingual-toggle').count(), 0)
  assert.equal(await page.locator('#call-mic').count(), 1)
  assert.equal(await page.locator('#call-bilingual').count(), 1)
})
