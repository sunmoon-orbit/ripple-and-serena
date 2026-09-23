import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

test('photo album: authenticated thumbnails, paging, details, upload and model image collection', { timeout: 90000 }, async t => {
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), base: '/', server: { host: '127.0.0.1', port: 0, hmr: false } })
  t.after(() => server.close()); await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const browser = await chromium.launch(); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await page.goto(origin)
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: PhotoAlbum } = await import('/src/components/Chat/PhotoAlbum.jsx')
    const { ThemedConfirmProvider } = await import('/src/components/ThemedConfirmDialog.jsx')
    const { useStore } = await import('/src/store.js')
    const canvas = document.createElement('canvas'); canvas.width = 60; canvas.height = 80
    const context = canvas.getContext('2d'); context.fillStyle = '#adcabc'; context.fillRect(0, 0, 60, 80)
    const image = canvas.toDataURL('image/png')
    const imageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    window.__albumImage = image; window.__albumRequests = []; window.__albumSaves = []
    window.__albumConfig = { enabled: true, baseUrl: 'https://fixture.invalid', apiToken: 'fixture-key' }
    const items = [2, 1].map(id => ({ id, title: `照片 ${id}`, description: `照片 ${id} 的完整描述。` + '一段很长的说明。'.repeat(30), author: 'Fixture', created_at: '2026-09-23T12:00:00Z' }))
    const originalFetch = window.fetch
    window.fetch = async (url, options = {}) => {
      if (!String(url).startsWith('https://fixture.invalid')) return originalFetch(url, options)
      window.__albumRequests.push({ url: String(url), headers: options.headers })
      if (options.headers?.Authorization !== 'Bearer fixture-key') return new Response('{}', { status: 401 })
      if (options.method === 'POST') {
        const body = JSON.parse(options.body); window.__albumSaves.push(body)
        const item = { ...body, id: items.length + 1, created_at: new Date().toISOString() }; items.unshift(item)
        return new Response(JSON.stringify(item))
      }
      if (/\/(thumb|image)$/.test(String(url))) return new Response(imageBlob)
      return new Response(JSON.stringify({ items, next_cursor: null }))
    }
    useStore.setState({ moonMemory: window.__albumConfig })
    const host = document.createElement('div'); document.body.append(host); document.getElementById('root').style.display = 'none'
    ReactDOM.createRoot(host).render(React.createElement(ThemedConfirmProvider, null, React.createElement(PhotoAlbum, { onClose() {}, messages: [{ id: 'message-fixture', role: 'user', content: 'A synthetic message', images: [image] }] })))
  })
  await page.getByRole('button', { name: '展开：照片 2', exact: true }).waitFor()
  await page.locator('.photo-album-thumb img').waitFor()
  assert.equal(await page.evaluate(() => window.__albumRequests.some(r => /\/image$/.test(r.url))), false)
  await page.getByRole('button', { name: '下一张', exact: true }).click()
  await page.getByRole('button', { name: '展开：照片 1', exact: true }).click()
  await page.locator('.photo-album-full-image img').waitFor()
  assert.ok(await page.evaluate(() => window.__albumRequests.some(r => /\/1\/image$/.test(r.url))))
  assert.ok((await page.locator('.photo-album-detail p').innerText()).length > 200)
  await page.getByRole('button', { name: '‹ 返回翻页', exact: true }).click()
  await page.getByRole('button', { name: '收藏聊天', exact: true }).click()
  await page.getByRole('button', { name: '收藏这张图片', exact: true }).click()
  await page.getByLabel('名字', { exact: true }).fill('聊天里的图片')
  await page.getByRole('button', { name: '收入相册', exact: true }).click()
  await page.getByRole('button', { name: '展开：聊天里的图片', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.__albumSaves[0].source), 'chat')
  assert.equal(await page.evaluate(() => 'thumb_data' in window.__albumSaves[0]), false)
  const result = await page.evaluate(async () => {
    const { executeAlbumTool } = await import('/src/api/album.js')
    const messages = [{ id: 'fixture-message', role: 'user', content: 'fixture', images: [window.__albumImage] }]
    const saved = await executeAlbumTool('save_album_image', { message_id: 'fixture-message', title: '模型收藏附件', author: 'Fixture', description: 'fixture' }, window.__albumConfig, messages)
    await executeAlbumTool('save_album_image', { image_url: 'https://example.org/image.jpg', source_url: 'https://example.org/photo', title: '网上图片', author: 'Fixture', description: 'fixture' }, window.__albumConfig)
    return { saved, remote: window.__albumSaves.at(-1), overflow: document.querySelector('.photo-album').scrollWidth > document.querySelector('.photo-album').clientWidth, tokenInUrl: window.__albumRequests.some(r => r.url.includes('fixture-key')) }
  })
  assert.equal(result.saved.saved, true)
  assert.equal(result.remote.image_url, 'https://example.org/image.jpg')
  assert.equal(result.remote.source_url, 'https://example.org/photo')
  assert.equal(result.tokenInUrl, false)
  assert.equal(result.overflow, false)
  assert.deepEqual(errors, [])
})
