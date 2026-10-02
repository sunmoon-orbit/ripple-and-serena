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
})

test('信纸里的黑鸟单独画成本地图，文字原样保留给划线偏移', () => {
  // 1002：换字体栈后她手机上信纸里仍拆成蓝鸟 + 黑方块，只在信纸正文兜底
  assert.match(letters, /withCrow\(s\.text\)/)
  assert.match(letters, /className="crow-inline"[^>]*>\{CROW_SEQ\}<\/span>/)
  assert.match(styles, /\.crow-inline\s*\{[^}]*color:\s*transparent/s)
  assert.equal(existsSync(new URL('../public/crow-emoji.svg', import.meta.url)), true)
})
