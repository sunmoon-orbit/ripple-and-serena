import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

test('album image is cropped locally, embedded in SVG and exported as PNG', { timeout: 60000 }, async t => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const server = await createServer({ root, base: '/', server: { host: '127.0.0.1', port: 0, hmr: false } })
  t.after(() => server.close())
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto(origin)

  const result = await page.evaluate(async () => {
    const { buildExcerptCardSvg, prepareExcerptCover, renderExcerptCardPng } = await import('/src/utils/bookExcerptCard.js')
    const canvas = document.createElement('canvas')
    canvas.width = 40
    canvas.height = 80
    const context = canvas.getContext('2d')
    context.fillStyle = '#c06b72'
    context.fillRect(0, 0, 40, 80)
    const sourceBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    const file = new File([sourceBlob], '相册测试.png', { type: 'image/png' })
    const imageDataUrl = await prepareExcerptCover(file)
    const details = { quote: '每一次摘录，都可以配一张不同的照片。', title: '测试书', author: '阿颖', chapter: '第一章', color: '#4a7c59', imageDataUrl }
    const svg = buildExcerptCardSvg(details)
    const png = await renderExcerptCardPng(details)
    return {
      dataPrefix: imageDataUrl.slice(0, 23),
      embedded: svg.includes('<image href="data:image/jpeg;base64,'),
      oldDecorationGone: !/moon-cut|M161 1185/.test(svg),
      pngType: png.type,
      pngSize: png.size,
    }
  })

  assert.equal(result.dataPrefix, 'data:image/jpeg;base64,')
  assert.equal(result.embedded, true)
  assert.equal(result.oldDecorationGone, true)
  assert.equal(result.pngType, 'image/png')
  assert.ok(result.pngSize > 10000)
})
