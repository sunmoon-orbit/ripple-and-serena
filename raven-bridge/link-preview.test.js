const test = require('node:test')
const assert = require('node:assert/strict')
const { isPrivateAddress, parseHtml } = require('./link-preview')

test('blocks local and private destinations', () => {
  for (const ip of ['127.0.0.1', '10.2.3.4', '172.16.0.1', '192.168.1.1', '::1', 'fd00::1']) assert.equal(isPrivateAddress(ip), true)
  assert.equal(isPrivateAddress('8.8.8.8'), false)
})

test('extracts social metadata and readable text', () => {
  const parsed = parseHtml('<html><head><meta property="og:title" content="卡片标题"><meta name="description" content="摘要"><meta property="og:image" content="/a.jpg"></head><body><script>bad()</script><article>这里是正文</article></body></html>', 'https://example.com/post')
  assert.equal(parsed.title, '卡片标题')
  assert.equal(parsed.image, 'https://example.com/a.jpg')
  assert.match(parsed.text, /这里是正文/)
  assert.doesNotMatch(parsed.text, /bad/)
})
