import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const component = readFileSync(new URL('../src/components/CrowEmoji.jsx', import.meta.url), 'utf8')
const letters = readFileSync(new URL('../src/components/Roost/index.jsx', import.meta.url), 'utf8')
const messages = readFileSync(new URL('../src/components/Chat/MessageBubble.jsx', import.meta.url), 'utf8')

test('言叽自带乌鸦图形，不依赖系统 emoji 字体', () => {
  assert.ok(existsSync(new URL('../public/crow-emoji.svg', import.meta.url)))
  assert.match(component, /export function CrowEmoji/)
  assert.match(component, /crow\.textContent = CROW_EMOJI/)
})

test('信件与聊天正文都替换不受支持的乌鸦组合', () => {
  assert.match(letters, /<CrowText>\{s\.text\}<\/CrowText>/)
  assert.match(messages, /enhanceCrowEmoji\(ref\.current\)/)
})
