import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('reader table of contents uses defined opaque theme surfaces', async () => {
  const css = await readFile(new URL('../src/styles/index.css', import.meta.url), 'utf8')
  const tocRule = css.match(/(?:^|\n)\.bookread-toc\s*\{([\s\S]*?)\}/)?.[1] || ''
  assert.match(tocRule, /background:\s*var\(--bg\)/)
  assert.match(tocRule, /border:\s*1px solid var\(--border-md\)/)
  assert.doesNotMatch(tocRule, /--bg-secondary/)
  assert.doesNotMatch(css, /\.bookread-toc-item[^}]*--text-primary/)
  assert.doesNotMatch(css, /\.bookread-toc-item[^}]*--bg-hover/)
})
