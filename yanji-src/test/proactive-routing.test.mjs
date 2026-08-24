import test from 'node:test'
import assert from 'node:assert/strict'

import {
  findConversationChat, hasProactiveMessage, normalizeConversationExternalId, pendingCallMatches,
  parseProactiveCreatedAt,
} from '../src/utils/proactiveRouting.js'

test('主动内容按稳定 external id 找到窗口且不会改变当前窗口', () => {
  const chats = [{ id: 'current-chat' }, { id: 'target-chat' }]
  const activeBefore = 'current-chat'
  assert.equal(findConversationChat(chats, 'target-chat'), chats[1])
  assert.equal(activeBefore, 'current-chat')
})

test('缺少或错误窗口标识时安全降级为未匹配', () => {
  const chats = [{ id: 'current-chat' }]
  assert.equal(normalizeConversationExternalId('  '), null)
  assert.equal(findConversationChat(chats, null), null)
  assert.equal(findConversationChat(chats, 'missing-chat'), null)
})

test('delivered 重试前可识别已经插入的主动消息', () => {
  const messages = [{ proactiveId: 17, content: 'fixture' }]
  assert.equal(hasProactiveMessage(messages, '17'), true)
  assert.equal(hasProactiveMessage(messages, 18), false)
})

test('原生接听只匹配同一来电，旧壳无 id 时保持兼容', () => {
  const invite = { serverId: 31 }
  assert.equal(pendingCallMatches({ callId: '31' }, invite), true)
  assert.equal(pendingCallMatches({ callId: '32' }, invite), false)
  assert.equal(pendingCallMatches({ at: Date.now() }, invite), true)
})


test('主动消息保留服务端真实发送时间，兼容 SQLite UTC 与 ISO 时间', () => {
  assert.equal(parseProactiveCreatedAt('2026-08-24 03:15:00'), Date.parse('2026-08-24T03:15:00Z'))
  assert.equal(parseProactiveCreatedAt('2026-08-24T11:15:00+08:00'), Date.parse('2026-08-24T11:15:00+08:00'))
  assert.equal(parseProactiveCreatedAt(''), null)
  assert.equal(parseProactiveCreatedAt('not-a-time'), null)
})
