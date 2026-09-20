import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('book annotations are an explicit tool-first path, not a model guess', () => {
  const source = readFileSync(new URL('../src/components/Chat/index.jsx', import.meta.url), 'utf8')
  assert.match(source, /先调用 reading_activity；需要具体内容时再用 list_books 和 get_book_annotations/)
  assert.match(source, /不得猜测「看不到」「没同步」/)
})
