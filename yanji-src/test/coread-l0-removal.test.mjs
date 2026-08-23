import test from 'node:test'
import assert from 'node:assert/strict'

import {
  fetchArchiveConversations,
  removeArchiveConversation,
  restoreArchiveConversation,
} from '../src/api/moonMemory.js'
import {
  hideCoreadConversation,
  restoreCoreadConversation,
} from '../src/components/Roost/coreadConversationList.js'

const config = { baseUrl: 'https://memory.example', apiToken: 'fixture-token' }

test('共读列表沿用服务端过滤结果，并聚合全部分页', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(url)
    const offset = Number(new URL(url).searchParams.get('offset'))
    const rows = offset === 0
      ? Array.from({ length: 200 }, (_, index) => ({ id: index + 1 }))
      : [{ id: 201, title: '新对话' }]
    return { ok: true, json: async () => rows }
  }

  const conversations = await fetchArchiveConversations(config)

  assert.equal(conversations.length, 201)
  assert.deepEqual(conversations.at(-1), { id: 201, title: '新对话' })
  assert.equal(calls.length, 2)
})

test('移除成功后可立即从共读本地列表隐藏', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return { ok: true, json: async () => ({ conversation_id: 2, removed: true }) }
  }
  const conversations = [
    { id: 1, title: 'cc 日期' },
    { id: 2, title: '新对话' },
    { id: 3, title: '普通窗口' },
  ]

  await removeArchiveConversation(config, 2)
  const visible = hideCoreadConversation(conversations, 2)

  assert.deepEqual(visible.map((item) => item.id), [1, 3])
  assert.equal(request.url, 'https://memory.example/archive/conversations/2/remove')
  assert.equal(request.options.method, 'POST')
  assert.deepEqual(JSON.parse(request.options.body), { confirm: true })
})

test('恢复成功后可立即放回原位置且不产生重复项', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return { ok: true, json: async () => ({ conversation_id: 2, removed: false }) }
  }
  const removed = { id: 2, title: '新对话' }

  await restoreArchiveConversation(config, 2)
  const restored = restoreCoreadConversation([{ id: 1 }, { id: 3 }, removed], removed, 1)

  assert.deepEqual(restored.map((item) => item.id), [1, 2, 3])
  assert.equal(request.url, 'https://memory.example/archive/conversations/2/restore')
  assert.equal(request.options.method, 'POST')
  assert.deepEqual(JSON.parse(request.options.body), { confirm: true })
})
