import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const component = readFileSync(new URL('../src/components/CrowEmoji.jsx', import.meta.url), 'utf8')
const letters = readFileSync(new URL('../src/components/Roost/index.jsx', import.meta.url), 'utf8')
const messages = readFileSync(new URL('../src/components/Chat/MessageBubble.jsx', import.meta.url), 'utf8')
const raven = readFileSync(new URL('../../raven/index.html', import.meta.url), 'utf8')
const roundtable = readFileSync(new URL('../../raven/roundtable.html', import.meta.url), 'utf8')
const ravenStyles = readFileSync(new URL('../src/styles/index.css', import.meta.url), 'utf8')

test('言叽自带乌鸦图形，不依赖系统 emoji 字体', () => {
  assert.ok(existsSync(new URL('../public/crow-emoji.svg', import.meta.url)))
  assert.match(component, /export function CrowEmoji/)
  assert.match(component, /crow\.textContent = CROW_EMOJI/)
  assert.doesNotMatch(ravenStyles, /\.crow-emoji\s*\{[^}]*font-size:\s*0/s)
})

test('信件与聊天正文都替换不受支持的乌鸦组合', () => {
  assert.match(letters, /<CrowText>\{s\.text\}<\/CrowText>/)
  assert.match(messages, /enhanceCrowEmoji\(ref\.current\)/)
})

test('归巢私聊与圆桌也只替换纯文本节点', () => {
  assert.match(raven, /const CROW_EMOJI = '\\u\{1F426\}\\u200D\\u2B1B'/)
  assert.match(roundtable, /const CROW_EMOJI = '\\u\{1F426\}\\u200D\\u2B1B'/)
  assert.match(raven, /closest\('code, pre, textarea, input, \.crow-emoji-fallback'\)/)
  assert.match(roundtable, /closest\('code, pre, textarea, input, \.crow-emoji-fallback'\)/)
  assert.ok(existsSync(new URL('../../raven/crow-emoji.svg', import.meta.url)))
  assert.match(raven, /class="crow-header-icon"/)
  assert.doesNotMatch(raven, /\.crow-emoji-fallback\s*\{[^}]*font-size:\s*0/s)
  assert.doesNotMatch(roundtable, /\.crow-emoji-fallback\s*\{[^}]*font-size:\s*0/s)
})
