import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const yanji = readFileSync(new URL('../src/components/Roost/MemoryPeek.jsx', import.meta.url), 'utf8')
const raven = readFileSync(new URL('../../raven/home.html', import.meta.url), 'utf8')

test('言叽按真实排版溢出显示记忆碎片展开按钮', () => {
  assert.match(yanji, /scrollHeight\s*>\s*el\.clientHeight/)
  assert.doesNotMatch(yanji, /rawContent\.length\s*>\s*200/)
  assert.match(yanji, /ref=\{contentRef\}/)
  assert.match(yanji, /\[rawContent, expanded, mem\?\.id\]/)
  assert.match(yanji, /document\.fonts\?\.ready\.then\(scheduleMeasure\)/)
})

test('归巢保留完整记忆正文并支持展开收起', () => {
  assert.match(raven, /function toggleMemory\(\)/)
  assert.match(raven, /contentEl\.textContent = text/)
  assert.doesNotMatch(raven, /text\.slice\(0, 200\)/)
  assert.match(raven, /scrollHeight\s*>\s*contentEl\.clientHeight/)
  assert.match(raven, /window\.addEventListener\('resize', scheduleMemoryOverflowMeasure\)/)
})
