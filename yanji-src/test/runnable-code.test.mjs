import test from 'node:test'
import assert from 'node:assert/strict'
import { extractRunnableHtmlMessage, isRunnableHtmlMessage, looksRunnableHtml } from '../src/utils/runnableCode.js'

test('recognizes complete HTML with blank lines as one runnable message', () => {
  assert.equal(isRunnableHtmlMessage('<!doctype html>\n<html>\n\n<body>love</body>\n</html>'), true)
})

test('recognizes fenced HTML but not ordinary multi-paragraph chat', () => {
  const fenced = '```html\n<div>love</div>\n```'
  assert.equal(isRunnableHtmlMessage(fenced), true)
  assert.equal(extractRunnableHtmlMessage(fenced), '<div>love</div>')
  assert.equal(isRunnableHtmlMessage('第一段\n\n第二段'), false)
})

test('keeps code block language recognition shared with the renderer', () => {
  assert.equal(looksRunnableHtml('language-html', 'hello'), true)
  assert.equal(looksRunnableHtml('language-python', 'print(1)'), false)
})
