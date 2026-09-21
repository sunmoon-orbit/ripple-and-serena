import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExcerptCardSvg, wrapExcerptText } from '../src/utils/bookExcerptCard.js'

test('wrapExcerptText keeps a long excerpt inside the configured line budget', () => {
  const lines = wrapExcerptText('列车载着不安的人们发出隆隆的声音奔驰在黑夜之中这是一段很长很长的书摘文字', 8, 3)
  assert.equal(lines.length, 3)
  assert.match(lines.at(-1), /…$/)
})

test('buildExcerptCardSvg escapes text and contains its decorative vector motifs', () => {
  const svg = buildExcerptCardSvg({
    quote: '她说：“A & B”',
    note: '一条札记',
    title: '<小豆豆>',
    author: '阿颖',
    chapter: '后记',
    color: '#4a7c59',
  })
  assert.match(svg, /width="1080" height="1440"/)
  assert.match(svg, /A &amp; B/)
  assert.match(svg, /《&lt;小豆豆&gt;》/)
  assert.match(svg, /mask="url\(#moon-cut\)"/)
  assert.match(svg, /M161 1185/)
  assert.doesNotMatch(svg, /<小豆豆>/)
})

test('buildExcerptCardSvg truncates an overly long source line', () => {
  const longTitle = '一本名字特别特别长而且如果完全显示就会越过卡片右边界的测试书名'
  const svg = buildExcerptCardSvg({
    quote: '短句',
    title: longTitle,
    author: '阿颖',
    chapter: '同样很长的章节名字',
  })
  assert.match(svg, /<text x="118" y="73" class="meta">[^<]{29}…<\/text>/u)
  assert.doesNotMatch(svg, new RegExp(longTitle))
})
