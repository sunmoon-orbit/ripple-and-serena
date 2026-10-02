import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMessageRenderWindow, renderCountForMessage } from '../src/utils/messageRenderWindow.mjs'

const messages = Array.from({ length: 205 }, (_, index) => ({ id: `m${index + 1}`, content: String(index + 1) }))

test('长窗口首绘只取末尾一批，但不修改原消息数组', () => {
  const result = buildMessageRenderWindow(messages, 80)
  assert.equal(result.rendered.length, 80)
  assert.equal(result.rendered[0].id, 'm126')
  assert.equal(result.rendered.at(-1).id, 'm205')
  assert.equal(result.remaining, 125)
  assert.equal(messages.length, 205)
})

test('隐藏消息不进入渲染窗口', () => {
  const result = buildMessageRenderWindow([{ id: 'a' }, { id: 'secret', hidden: true }, { id: 'b' }], 10)
  assert.deepEqual(result.rendered.map((message) => message.id), ['a', 'b'])
})

test('跳转到旧消息时计算需要展开的最小尾部窗口', () => {
  assert.equal(renderCountForMessage(messages, 'm20', 80), 186)
  assert.equal(renderCountForMessage(messages, 'm190', 80), 80)
  assert.equal(renderCountForMessage(messages, 'missing', 80), 80)
})
