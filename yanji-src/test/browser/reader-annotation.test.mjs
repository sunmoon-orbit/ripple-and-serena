import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

test('paged annotations open in place and paging uses the actual viewport', { timeout: 60000 }, async t => {
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), base: '/', server: { host: '127.0.0.1', port: 0, hmr: false } })
  t.after(() => server.close()); await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const browser = await chromium.launch(); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } })
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await page.goto(origin)
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: BookRead } = await import('/src/components/Roost/BookRead.jsx')
    const { ThemedConfirmProvider } = await import('/src/components/ThemedConfirmDialog.jsx')
    const { useStore } = await import('/src/store.js')
    const book = { id: 987, title: '测试书', chapter_count: 1 }
    const originalFetch = window.fetch
    window.fetch = (url, options) => {
      if (!String(url).startsWith('https://fixture.invalid')) return originalFetch(url, options)
      const path = new URL(url).pathname
      const data = path.endsWith('/books') ? [book] : path.includes('/chapters/') ? { idx: 0, title: '第一章', content: '测试划线' + '这是正文。'.repeat(1800), annotations: [{ id: 7, start_off: 0, end_off: 4, quote: '测试划线', note: '卡片里的批注', author: '测试', color: 'yellow' }] } : path.endsWith('/chat') ? [] : {}
      return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
    }
    useStore.setState({ moonMemory: { baseUrl: 'https://fixture.invalid', apiToken: 'fixture' } })
    const host = document.createElement('div'); document.body.append(host)
    document.getElementById('root').style.display = 'none'
    ReactDOM.createRoot(host).render(React.createElement(ThemedConfirmProvider, null, React.createElement(BookRead, { onClose() {} })))
  })
  await page.locator('.bookread-book').click()
  await page.locator('.bookread-mark').click()
  await page.getByRole('dialog', { name: '划线批注' }).waitFor()
  assert.equal(await page.locator('.bookread-body-page').count(), 1)
  const before = await page.locator('.bookread-text-paged').evaluate(el => el.style.transform)
  await page.getByRole('button', { name: '关闭批注' }).click()
  assert.equal(await page.locator('.bookread-annotation-popover').count(), 0)
  assert.equal(await page.locator('.bookread-text-paged').evaluate(el => el.style.transform), before)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  const position = await page.locator('.bookread-text-paged').evaluate(el => ({ transform: el.style.transform, width: el.parentElement.clientWidth }))
  assert.equal(position.transform, `translate3d(-${position.width}px, 0px, 0px)`)
})
