import assert from 'node:assert/strict'
import test from 'node:test'
import { createT9Index, getT9PinyinKeys, toT9Digits } from '../src/utils/t9Pinyin.js'

test('converts letters to standard T9 digits', () => {
  assert.equal(toT9Digits('qing'), '7464')
  assert.equal(toT9Digits('NiHao'), '64426')
  assert.equal(toT9Digits("xi'an"), '9426')
})

test('returns exact pinyin matches before longer predictions', () => {
  const index = createT9Index({
    ni: [{ w: '你', f: 900 }],
    mi: [{ w: '米', f: 500 }],
    nian: [{ w: '年', f: 5000 }],
  })

  assert.deepEqual(
    getT9PinyinKeys(index, '64').map((item) => item.pinyin),
    ['ni', 'mi', 'nian'],
  )
})

test('returns no suggestions for an impossible digit path', () => {
  const index = createT9Index({ ni: [{ w: '你', f: 900 }] })
  assert.deepEqual(getT9PinyinKeys(index, '23'), [])
})
