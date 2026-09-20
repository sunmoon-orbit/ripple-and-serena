import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { localCommand, modelLabel, imageSupported } from '../src/components/Crossing/controls.mjs'
import { createSessionFlow } from '../src/components/Crossing/session-flow.mjs'
import { prepareAttachment } from '../src/utils/attachments.js'

test('/model is a local command and cannot become a turn; model labels use confirmed metadata', () => {
  assert.deepEqual(localCommand('/model'), { name: 'model', argument: '' })
  assert.deepEqual(localCommand(' /MODEL '), { name: 'model', argument: '' })
  assert.equal(modelLabel(null), '尚未确认模型')
  assert.equal(modelLabel({ model: 'server-model', reasoningEffort: 'high' }), 'server-model · high')
  assert.equal(imageSupported([{ model: 'text', inputModalities: ['text'] }], 'text'), false)
  assert.equal(imageSupported([], 'unknown'), false)
  assert.equal(imageSupported([{ model: 'vision', inputModalities: ['image','text'] }], 'vision'), true)
  const sent = [], flow = createSessionFlow(x => sent.push(x))
  flow.receive({ type: 'crossing/authenticated' }); flow.create({ model: 'server-model', effort: 'high' })
  const request = sent.at(-1)
  assert.equal(request.model, 'server-model'); assert.equal(request.effort, 'high')
  flow.receive({ type: 'crossing/thread', requestId: request.requestId, action: 'started', ready: true, thread: { id: 't', model: 'server-model', reasoningEffort: 'high' } })
  const count = sent.length
  assert.equal(flow.start('/model', 'm'), false); assert.equal(sent.length, count)
})

test('sticker attachment uses actual image input reference, text files retain content', async () => {
  const sent = [], flow = createSessionFlow(x => sent.push(x))
  flow.receive({ type: 'crossing/authenticated' }); flow.create()
  flow.receive({ type: 'crossing/thread', requestId: sent.at(-1).requestId, ready: true, action: 'started', thread: { id: 't' } })
  const url = 'https://memory.ravenlove.cc/raven/stickers/kaixin.png'
  assert.equal(flow.start('', 'm', { attachments: [{ url }] }), true)
  assert.deepEqual(sent.at(-1).attachments, [{ url }])
  const file = await prepareAttachment({ name: 'test.md', type: 'text/markdown', size: 5, arrayBuffer: async () => new TextEncoder().encode('hello').buffer }, true)
  assert.equal(file.content, 'hello'); assert.equal(atob(file.data), 'hello')
  await assert.rejects(prepareAttachment({ name: 'test.pdf', type: 'application/pdf', size: 5 }, true), /暂不支持/)
})

test('all existing sidebar tools remain represented in Crossing', () => {
  const original = readFileSync(new URL('../src/components/Chat/ConversationList.jsx', import.meta.url), 'utf8')
  const region = original.slice(original.indexOf('{canCall ?'), original.indexOf('onOpenIdleJournal?.()') + 900)
  const names = [...region.matchAll(/<span>([^<]+)<\/span>/g)].map(m => m[1])
  const controls = readFileSync(new URL('../src/components/Crossing/Tools.jsx', import.meta.url), 'utf8')
  assert.ok(names.length >= 15)
  for (const name of names) assert.ok(controls.includes(name), `missing tool: ${name}`)
})
