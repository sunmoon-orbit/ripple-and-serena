import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CROSSING_CALL_BILINGUAL_NOTE,
  CROSSING_CALL_NOTE,
  threadsFromRead,
  visibleUserText,
  withHiddenContext,
} from '../src/components/Crossing/messages.mjs'

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

test('history hides marked and legacy call instructions from the user bubble', () => {
  const marked = withHiddenContext('哥哥！', CROSSING_CALL_BILINGUAL_NOTE)
  assert.match(marked, /<crossing-hidden-context>/)
  assert.equal(visibleUserText(marked), '哥哥！')
  assert.equal(visibleUserText(`听见我了吗\n\n${CROSSING_CALL_NOTE}`), '听见我了吗')

  const [message] = threadsFromRead({ turns: [{ items: [{ id: 'call', type: 'userMessage', content: [
    { type: 'text', text: `哥哥！\n\n${CROSSING_CALL_BILINGUAL_NOTE}` },
  ] }] }] })
  assert.equal(message.text, '哥哥！')
})
