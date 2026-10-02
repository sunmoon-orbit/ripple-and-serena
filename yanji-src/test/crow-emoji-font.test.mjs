import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const styles = readFileSync(new URL('../src/styles/index.css', import.meta.url), 'utf8')
const letters = readFileSync(new URL('../src/components/Roost/index.jsx', import.meta.url), 'utf8')
const messages = readFileSync(new URL('../src/components/Chat/MessageBubble.jsx', import.meta.url), 'utf8')
const raven = readFileSync(new URL('../../raven/index.html', import.meta.url), 'utf8')
const roundtable = readFileSync(new URL('../../raven/roundtable.html', import.meta.url), 'utf8')

test('信件正文优先使用系统彩色 emoji 字体', () => {
  const rule = styles.match(/\.roost-letter-paper-body\s*\{[^}]*\}/s)?.[0] || ''
  assert.match(rule, /font-family:\s*"Noto Color Emoji",\s*"Apple Color Emoji",\s*"Segoe UI Emoji"/)
  assert.match(letters, /className="roost-letter-paper-body"/)
  assert.doesNotMatch(letters, /CrowEmoji|CrowText/)
  assert.doesNotMatch(messages, /enhanceCrowEmoji/)
})

test('归巢与圆桌保留手机原生黑乌鸦 emoji', () => {
  assert.match(raven, /<span class="crow-icon">🐦‍⬛<\/span>/)
  assert.doesNotMatch(raven, /crow-emoji-fallback|enhanceCrowEmoji|crow-emoji\.svg/)
  assert.doesNotMatch(roundtable, /crow-emoji-fallback|enhanceCrowEmoji|crow-emoji\.svg/)
  assert.equal(existsSync(new URL('../../raven/crow-emoji.svg', import.meta.url)), false)
  assert.equal(existsSync(new URL('../public/crow-emoji.svg', import.meta.url)), false)
})
