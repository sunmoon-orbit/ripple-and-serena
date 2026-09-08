import test from 'node:test'
import assert from 'node:assert/strict'
import { extractEmotionUpdate, stripEmotionTag } from '../src/utils/emotion.js'

test('extracts the normal wrapped emotion update', () => {
  assert.deepEqual(extractEmotionUpdate('亲亲。<es>{"j":+8,"d":+5}</es>'), {
    clean: '亲亲。',
    delta: { j: 8, d: 5 },
  })
})

test('extracts a standalone bare emotion JSON object at the reply tail', () => {
  const text = '啾啾，亲亲小猫咪。\n{"j":+6,"w":+6,"fo":+8,"d":+7,"lo":+5}'
  assert.deepEqual(extractEmotionUpdate(text), {
    clean: '啾啾，亲亲小猫咪。',
    delta: { j: 6, w: 6, fo: 8, d: 7, lo: 5 },
  })
  assert.equal(stripEmotionTag(text), '啾啾，亲亲小猫咪。')
})

test('preserves ordinary, invalid, inline, and fenced JSON', () => {
  const samples = [
    '接口返回：\n{"status":"ok"}',
    '情绪例子：{"j":+6}',
    '```json\n{"j":6}\n```',
    '正文\n{"j":"很开心"}',
    '正文\n{"j":101}',
  ]
  for (const text of samples) {
    assert.deepEqual(extractEmotionUpdate(text), { clean: text, delta: null })
    assert.equal(stripEmotionTag(text), text)
  }
})
