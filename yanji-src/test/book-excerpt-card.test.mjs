import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExcerptCardSvg, excerptCardTextLayout, wrapExcerptText } from '../src/utils/bookExcerptCard.js'

test('wrapExcerptText keeps a long excerpt inside the configured line budget', () => {
  const lines = wrapExcerptText('列车载着不安的人们发出隆隆的声音奔驰在黑夜之中这是一段很长很长的书摘文字', 8, 3)
  assert.equal(lines.length, 3)
  assert.match(lines.at(-1), /…$/)
})

test('buildExcerptCardSvg escapes text and uses the simplified photo-and-paper layout', () => {
  const svg = buildExcerptCardSvg({
    quote: '她说：“A & B”',
    note: '一条札记',
    title: '<小豆豆>',
    author: '阿颖',
    chapter: '后记',
    color: '#4a7c59',
    imageDataUrl: 'data:image/jpeg;base64,fixture',
    readingTime: '2 小时 12 分钟',
  })
  assert.match(svg, /width="1080" height="1440"/)
  assert.match(svg, /A &amp; B/)
  assert.match(svg, /《&lt;小豆豆&gt;》/)
  assert.match(svg, /<image href="data:image\/jpeg;base64,fixture"/)
  assert.match(svg, /M0 548Q0 500 48 500/)
  assert.match(svg, /言叽书架摘录/)
  assert.match(svg, /本书近 7 天已读 2 小时 12 分钟/)
  assert.doesNotMatch(svg, /moon-cut|M161 1185/)
  assert.doesNotMatch(svg, /<小豆豆>/)
})

test('buildExcerptCardSvg falls back to a quiet spine-color cover without a photo', () => {
  const svg = buildExcerptCardSvg({ quote: '短句', color: '#4a7c59' })
  assert.match(svg, /id="fallback"/)
  assert.match(svg, /stop-color="#4a7c59"/)
  assert.doesNotMatch(svg, /<image href=/)
})

test('buildExcerptCardSvg truncates an overly long source line', () => {
  const longTitle = '一本名字特别特别长而且如果完全显示就会越过卡片右边界的测试书名'
  const svg = buildExcerptCardSvg({
    quote: '短句',
    title: longTitle,
    author: '阿颖',
    chapter: '同样很长的章节名字',
  })
  assert.match(svg, /<text x="84" y="1314" class="meta">[^<]{33}…<\/text>/u)
  assert.doesNotMatch(svg, new RegExp(longTitle))
})

test('short excerpts give unused paper space to longer annotations', () => {
  const note = '我时常觉得每个人都是有天赋的，极度贫瘠之人反而是少数。只是大多数人的天赋，在日复一日枯燥的生活中以及各种不同的原因中，慢慢被遮住了。等到偶然回头时，才会发现那些没有说出口的念头，其实一直安静地留在心里，并没有真正消失。'
  const layout = excerptCardTextLayout('这是一段四行以内的短书摘，用来给批注留下更多纸面。', note)
  assert.ok(layout.noteLineLimit >= 4)
  assert.ok(layout.noteLines.length >= 4)
  const svg = buildExcerptCardSvg({ quote: '这是一段四行以内的短书摘，用来给批注留下更多纸面。', note })
  assert.match(svg, /大多数人的天赋/)
  assert.match(svg, /并没有真正消失。/)
})

test('long excerpts shrink annotation space before the fixed source area', () => {
  const layout = excerptCardTextLayout('很长的正文'.repeat(40), '很长的批注'.repeat(40))
  assert.equal(layout.quoteLines.length, 7)
  assert.equal(layout.noteLineLimit, 0)
  assert.equal(layout.noteLines.length, 0)
})
