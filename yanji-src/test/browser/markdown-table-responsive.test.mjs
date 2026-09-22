import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

test('wide markdown tables scroll inside the message instead of widening it', { timeout: 60000 }, async t => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const server = await createServer({ root, base: '/', server: { host: '127.0.0.1', port: 0, hmr: false } })
  t.after(() => server.close())
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 360, height: 720 } })
  await page.goto(origin)

  const result = await page.evaluate(async () => {
    const { enhanceMarkdownTables } = await import('/src/utils/markdownTables.js')
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = '/src/styles/index.css'
    document.head.appendChild(css)
    await new Promise(resolve => { css.onload = resolve })
    document.body.innerHTML = `<div class="message-bubble" style="width:260px"><div class="bubble-markdown"><table><tbody><tr>${Array.from({ length: 6 }, (_, i) => `<td>很长的第${i + 1}列表格内容</td>`).join('')}</tr></tbody></table></div></div>`
    const bubble = document.querySelector('.message-bubble')
    enhanceMarkdownTables(bubble)
    const scroller = bubble.querySelector('.markdown-table-scroll')
    return {
      wrapped: Boolean(scroller),
      bubbleWidth: bubble.getBoundingClientRect().width,
      scrollerWidth: scroller.getBoundingClientRect().width,
      scrollWidth: scroller.scrollWidth,
      aria: scroller.getAttribute('aria-label'),
    }
  })

  assert.equal(result.wrapped, true)
  assert.equal(result.bubbleWidth, 260)
  assert.ok(result.scrollerWidth <= result.bubbleWidth)
  assert.ok(result.scrollWidth > result.scrollerWidth)
  assert.equal(result.aria, '表格，可左右滑动')
})
