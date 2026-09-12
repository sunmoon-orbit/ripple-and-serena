import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractRunnableHtmlMessage as extract } from '../src/utils/runnableCode.js'
for (const html of ['<h1>爱心</h1>', '<button>点我</button>', '<canvas/>', '<!doctype html><html></html>', '<!-- gift --><p>hi</p>']) {
  test(`recognizes ${html}`, () => {
    assert.equal(extract(html), html)
    assert.equal(extract('```\n' + html + '\n```'), html)
    assert.equal(extract('```html\r\n' + html + '\r\n```'), html)
    assert.equal(extract('~~~html\n' + html + '\n~~~'), html)
  })
}
test('does not execute prose or other languages', () => {
  for (const text of ['你好', '<hello>hi</hello>', '```js\nalert(1)\n```', '```python\nprint(1)\n```', '```html\n<p>unfinished']) assert.equal(extract(text), '')
})
