import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

test('归巢 CC 设置可从列表切换当前 Claude Code 模型', { timeout: 60000 }, async t => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const server = await createServer({ root, base: '/', server: { host: '127.0.0.1', port: 0, hmr: false } })
  t.after(() => server.close()); await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const browser = await chromium.launch(); t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })
  await context.routeWebSocket('**/*', socket => socket.close())
  let switched = null
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin && url.pathname === '/raven/cc-settings') {
      if (request.method() === 'POST') {
        switched = request.postDataJSON()
        return route.fulfill({ json: { model: switched.model, applied: 'current_session', queued: true } })
      }
      if (url.searchParams.get('kind') === 'model') return route.fulfill({ json: {
        model: '', currentModel: 'claude-opus-5', revision: 'model-revision',
        models: [
          { id: 'opus', label: 'Opus（自动使用最新版本）', source: 'alias' },
          { id: 'sonnet', label: 'Sonnet（自动使用最新版本）', source: 'alias' },
          { id: 'claude-opus-5', label: 'claude-opus-5', source: 'active' },
        ],
      } })
      return route.fulfill({ json: { content: '# Fixture', exists: true, revision: 'document-revision' } })
    }
    if (url.origin === origin) return route.continue()
    return route.abort()
  })
  await context.addInitScript(() => localStorage.setItem('raven-token', 'fixture-only'))
  const page = await context.newPage()
  await page.goto(origin + '/raven/index.html')
  assert.match(await page.locator('script[src*="cc-settings.js"]').getAttribute('src'), /\?v=/)
  await page.evaluate(() => document.getElementById('cc-settings-open').click())
  await page.locator('#cc-model-select').selectOption('sonnet', { timeout: 10000 })
  await page.getByRole('button', { name: '切换当前会话' }).click()
  await page.getByText(/已选择 sonnet（最新可用版本）/).waitFor({ timeout: 10000 })
  assert.deepEqual(switched, { kind: 'model-switch', model: 'sonnet' })
})
