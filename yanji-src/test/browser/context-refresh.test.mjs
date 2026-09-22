import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

test('context cursor and note commit together; edits invalidate them without deleting history', { timeout: 60000 }, async t => {
  const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), base: '/', server: { host: '127.0.0.1', port: 0, hmr: false } })
  t.after(() => server.close()); await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await page.goto(origin)
  const result = await page.evaluate(async () => {
    const { useStore } = await import('/src/store.js')
    const { contextRefreshPlan } = await import('/src/utils/contextRefresh.js')
    while (!useStore.getState().bigReady) await new Promise(r => setTimeout(r, 20))
    const messages = Array.from({ length: 80 }, (_, i) => ({ id: String(i), role: i % 2 ? 'assistant' : 'user', content: '测试' }))
    useStore.setState({ chats: [{ id: 'fixture', title: '认真起的名字', compactionVersion: 0 }], messagesByChatId: { fixture: messages }, summariesByChatId: {} })
    useStore.getState().commitCompaction('fixture', '有效笔记', '67', 0)
    let s = useStore.getState()
    const committed = { title: s.chats[0].title, count: s.messagesByChatId.fixture.length, start: contextRefreshPlan(messages, s.chats[0], !!s.getSummary('fixture')).start }
    s.updateMessage('fixture', '1', { content: '修正旧事实' })
    s = useStore.getState()
    s.commitCompaction('fixture', '过期结果', '67', 0)
    s = useStore.getState()
    return { committed, summary: s.getSummary('fixture'), cursor: s.chats[0].compactedThrough, count: s.messagesByChatId.fixture.length }
  })
  assert.deepEqual(result.committed, { title: '认真起的名字', count: 80, start: 68 })
  assert.equal(result.summary, null)
  assert.equal(result.cursor, null)
  assert.equal(result.count, 80)
})
