import test from 'node:test'
import assert from 'node:assert/strict'
import { Marked } from 'marked'

import { underlineExtension } from '../src/utils/markdownUnderline.js'

const markdown = new Marked({ gfm: true, breaks: true })
markdown.use({ extensions: [underlineExtension] })

test('言叽下划线扩展支持单独和组合格式', () => {
  assert.match(markdown.parse('__正文__'), /<u>正文<\/u>/)
  assert.match(markdown.parse('___正文___'), /<u><em>正文<\/em><\/u>/)
  assert.match(markdown.parse('__**正文**__'), /<u><strong>正文<\/strong><\/u>/)
})

test('标准 Markdown 格式保持可用', () => {
  const html = markdown.parse('**粗体** *斜体* ***粗斜体*** ~~删除线~~ [链接](https://example.com)')
  assert.match(html, /<strong>粗体<\/strong>/)
  assert.match(html, /<em>斜体<\/em>/)
  assert.match(html, /<em><strong>粗斜体<\/strong><\/em>/)
  assert.match(html, /<del>删除线<\/del>/)
  assert.match(html, /<a href="https:\/\/example\.com">链接<\/a>/)
})

test('引用、列表和行内代码保持可用', () => {
  const html = markdown.parse('> 引用\n\n- 项目\n\n`代码`')
  assert.match(html, /<blockquote>/)
  assert.match(html, /<ul>[\s\S]*<li>项目<\/li>/)
  assert.match(html, /<code>代码<\/code>/)
})

test('代码中的双下划线保持原文', () => {
  assert.match(markdown.parse('`__inline__`'), /<code>__inline__<\/code>/)
  assert.match(markdown.parse('```js\nconst __value__ = 1\n```'), /const __value__ = 1/)
})
