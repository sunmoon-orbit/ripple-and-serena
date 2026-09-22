import test from 'node:test'
import assert from 'node:assert/strict'
import { threadsFromRead } from '../src/components/Crossing/messages.mjs'

test('history keeps image previews and file cards separate from user text', () => {
  const [message] = threadsFromRead({ turns: [{ items: [{ id: 'fixture', type: 'userMessage', content: [
    { type: 'text', text: '看看这张图' },
    { type: 'image', url: 'data:image/png;base64,AA==' },
    { type: 'file', name: '笔记.txt', url: 'data:text/plain;base64,AA==' },
    { type: 'image', url: 'file:///private/secret.png' },
  ] }] }] })
  assert.equal(message.text, '看看这张图')
  assert.deepEqual(message.previews, ['data:image/png;base64,AA=='])
  assert.equal(message.files[0].name, '笔记.txt')
})
