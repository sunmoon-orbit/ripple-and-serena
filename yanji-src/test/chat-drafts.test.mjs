import test from 'node:test'
import assert from 'node:assert/strict'

import { updateChatDraft, removeChatDraft } from '../src/utils/chatDrafts.js'

test('不同对话的草稿互不覆盖', () => {
  let drafts = updateChatDraft({}, 'chat-a', '第一扇窗')
  drafts = updateChatDraft(drafts, 'chat-b', '第二扇窗')
  assert.deepEqual(drafts, { 'chat-a': '第一扇窗', 'chat-b': '第二扇窗' })
})

test('函数式更新不会丢掉系统分享前已有的文字', () => {
  const drafts = updateChatDraft({ a: '开头' }, 'a', (prev) => prev + '\n分享内容')
  assert.equal(drafts.a, '开头\n分享内容')
})

test('发送或删除对话后只清理对应草稿', () => {
  const drafts = removeChatDraft({ a: '待发', b: '保留' }, 'a')
  assert.deepEqual(drafts, { b: '保留' })
})
