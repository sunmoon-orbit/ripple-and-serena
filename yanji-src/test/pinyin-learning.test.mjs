import test from 'node:test'
import assert from 'node:assert/strict'
import {
  forgetPinyinSelection,
  loadPinyinLearning,
  rankPinyinCandidates,
  recordPinyinSelection,
  savePinyinLearning,
} from '../src/utils/pinyinLearning.js'

test('learned word moves ahead of dictionary order', () => {
  let learning = {}
  learning = recordPinyinSelection(learning, 'qingqing', '清清', 1000)
  learning = recordPinyinSelection(learning, 'qingqing', '清清', 2000)
  const ranked = rankPinyinCandidates([
    { word: '轻轻', matchedLength: 8 },
    { word: '清清', matchedLength: 8 },
  ], 'qingqing', learning, 3000)
  assert.equal(ranked[0].word, '清清')
})

test('learned custom word is offered even when dictionary lacks it', () => {
  const learning = recordPinyinSelection({}, 'ayao', '阿曜', 1000)
  const ranked = rankPinyinCandidates([{ word: '阿瑶', matchedLength: 4 }], 'ayao', learning, 2000)
  assert.deepEqual(ranked[0], { word: '阿曜', matchedLength: 4 })
})

test('learning can be forgotten and survives storage round trip', () => {
  const memory = new Map()
  const storage = {
    getItem: (key) => memory.get(key) || null,
    setItem: (key, value) => memory.set(key, value),
  }
  const learning = recordPinyinSelection({}, 'lang', '狼', 1000)
  assert.equal(savePinyinLearning(learning, storage), true)
  const loaded = loadPinyinLearning(storage)
  assert.equal(loaded.lang[0].word, '狼')
  assert.deepEqual(forgetPinyinSelection(loaded, 'lang', '狼'), {})
})
