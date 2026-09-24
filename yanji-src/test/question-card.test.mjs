import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeQuestion } from '../src/utils/questionCard.js'

test('normalizes mixed options, removes duplicates, and keeps only one recommendation', () => {
  const result = normalizeQuestion({
    question: '  今天吃什么？ ',
    options: [
      { label: '火锅', recommended: true },
      { label: '火锅' },
      { label: '米线', description: '清淡一点', recommended: true },
      '寿司',
      '烧烤',
      '第五个会被截掉',
    ],
    allow_custom: false,
  })
  assert.equal(result.question, '今天吃什么？')
  assert.deepEqual(result.options.map((item) => item.label), ['火锅', '米线', '寿司', '烧烤'])
  assert.deepEqual(result.options.map((item) => item.recommended), [true, false, false, false])
  assert.equal(result.allowCustom, false)
})

test('provides safe defaults for malformed tool arguments', () => {
  const result = normalizeQuestion({ options: [null, '', { label: '  A  ' }] })
  assert.equal(result.question, '你想选哪一个？')
  assert.deepEqual(result.options.map((item) => item.label), ['A'])
  assert.equal(result.allowCustom, true)
})
