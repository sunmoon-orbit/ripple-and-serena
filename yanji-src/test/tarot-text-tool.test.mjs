import test from 'node:test'
import assert from 'node:assert/strict'
import { extractTextualTarotReading, stripTextualTarotReading } from '../src/api/tarot.js'

test('extracts a textual tarot reading call from the reply tail', () => {
  const source = '慢慢来，也会达成目标。\n[draw_tarot:reading|id=12|星币侍从：把目标拆小，一步步积累。]'
  assert.deepEqual(extractTextualTarotReading(source), {
    clean: '慢慢来，也会达成目标。',
    reading: { id: 12, text: '星币侍从：把目标拆小，一步步积累。' },
  })
  assert.equal(stripTextualTarotReading(source), '慢慢来，也会达成目标。')
})

test('preserves inline examples, other actions, and malformed calls', () => {
  const samples = [
    '示例：[draw_tarot:reading|id=12|文字]',
    '[draw_tarot:draw|id=12|文字]',
    '[draw_tarot:reading|id=0|文字]',
    '[draw_tarot:reading|id=12|]',
    '```text\n[draw_tarot:reading|id=12|文字]\n```',
  ]
  for (const source of samples) {
    assert.deepEqual(extractTextualTarotReading(source), { clean: source, reading: null })
    assert.equal(stripTextualTarotReading(source), source)
  }
})
