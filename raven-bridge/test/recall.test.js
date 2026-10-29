const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const recall = require('../recall')

const old = new Date(Date.now() - 30 * 86400e3).toISOString()
const row = (id, sim, extra = {}) => ({ id, type: 'memory', _sim: sim, content: '内容' + id, created_at: old, ...extra })
function reset() { try { fs.unlinkSync(path.join(__dirname, '..', 'recall-state.json')) } catch {} }

test('短句和贴图不翻', async () => {
  reset()
  let called = false
  const s = async () => { called = true; return [] }
  assert.equal(await recall.surface('亲亲', s), '')
  assert.equal(await recall.surface('[sticker:x.png｜猫]', s), '')
  assert.equal(called, false)
})

test('浮一条，冷却期内不再浮同一条', async () => {
  reset()
  const s = async () => [row(1, 0.5), row(2, 0.48)]
  const a = await recall.surface('我们之前聊过的服务器计划怎么样了', s)
  assert.match(a, /#1/)
  const b = await recall.surface('我们之前聊过的服务器计划怎么样了', s)
  assert.match(b, /#2/)
})

test('技术记录、两天内的新记录、分数低的不浮', async () => {
  reset()
  const fresh = new Date().toISOString()
  const s = async () => [row(3, 0.6, { type: 'tech' }), row(4, 0.6, { created_at: fresh }), row(5, 0.3)]
  assert.equal(await recall.surface('这个问题我们上次是怎么解决的来着', s), '')
})

test('搜索超时不卡住', async () => {
  reset()
  const s = () => new Promise(() => {})
  const t0 = Date.now()
  assert.equal(await recall.surface('一句足够长的话来测试超时会不会卡住', s), '')
  assert.ok(Date.now() - t0 < 4000)
})

test('语音条和引用的壳洗掉', () => {
  assert.equal(recall.queryOf('【语音条·5秒】今天好累 〔机器听到：疲惫〕\n[附件: /x.webm]'), '今天好累')
})
