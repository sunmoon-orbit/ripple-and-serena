import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

test('共读批注提交后立即收起输入栏，不等待网络返回', { timeout: 60000 }, async t => {
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), base: '/', server: { host: '127.0.0.1', port: 0, hmr: false } })
  t.after(() => server.close()); await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const browser = await chromium.launch(); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 740, height: 390 }, isMobile: true, hasTouch: true })
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await page.goto(origin)
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: CoRead } = await import('/src/components/Roost/CoRead.jsx')
    const { ThemedConfirmProvider } = await import('/src/components/ThemedConfirmDialog.jsx')
    const { useStore } = await import('/src/store.js')
    const originalFetch = window.fetch
    window.fetch = (url, options = {}) => {
      if (!String(url).startsWith('https://fixture.invalid')) return originalFetch(url, options)
      const parsed = new URL(url)
      const path = parsed.pathname
      let data = {}
      if (path === '/archive/conversations') data = [{ id: 12, title: '测试旧时光', source: 'yanji', created_at: '2026-09-25' }]
      else if (path === '/archive/conversations/12' && !path.endsWith('/annotations')) data = { messages: [{ id: 34, role: 'assistant', content: '这是一段等着批注的正文。' }] }
      else if (path.endsWith('/annotations') && (options.method || 'GET') === 'GET') data = []
      else if (path.endsWith('/bookmark')) data = null
      else if (path.endsWith('/annotations') && options.method === 'POST') {
        return new Promise(resolve => {
          window.__finishAnnotation = () => resolve(new Response(JSON.stringify({ id: 56, message_id: 34, author: '阿颖', color: 'yellow', note: '写好了' }), { headers: { 'Content-Type': 'application/json' } }))
        })
      }
      return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
    }
    useStore.setState({ moonMemory: { baseUrl: 'https://fixture.invalid', apiToken: 'fixture' } })
    const host = document.createElement('div'); document.body.append(host)
    document.getElementById('root').style.display = 'none'
    ReactDOM.createRoot(host).render(React.createElement(ThemedConfirmProvider, null, React.createElement(CoRead, { onClose() {} })))
  })

  await page.getByText('测试旧时光').click()
  await page.getByText('这是一段等着批注的正文。').click()
  await page.getByPlaceholder('写一句批注（留空＝纯高亮）……').fill('写好了')
  await page.getByRole('button', { name: '留下', exact: true }).click()

  assert.equal(await page.locator('.coread-anno-compose').count(), 0)
  await page.evaluate(() => window.__finishAnnotation())
  await page.getByText('写好了', { exact: true }).waitFor()
})
