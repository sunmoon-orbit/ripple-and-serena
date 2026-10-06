const test = require('node:test')
const assert = require('node:assert/strict')
const { authStateFromCapture, createAuthGate } = require('../cc-auth-state')

const RULE = '─'.repeat(60)
const BOX = ['', RULE, '❯  ', RULE, '  [Opus 5.5] 66% context', '  ⏵⏵ auto mode on']
const ERR = ['● Please run /login · API Error: 403 Access to this model requires an access grant your', '  request does not have.', '', '✻ Crunched for 3s · done 1:54 AM']

test('1006 早上的屏幕：她的话交上去了，回的是 403，卡住', () => {
  const cap = ['● 昨晚的总结……', '', '❯ 【阿颖】成功在10点之前起床！', '', ...ERR, ...BOX].join('\n')
  assert.equal(authStateFromCapture(cap).broken, true)
})

test('报错之后她从终端敲了一句：还没回话也不算卡住了', () => {
  const cap = ['❯ 【阿颖】成功在10点之前起床！', '', ...ERR, '', '❯ 老公？', '', ...BOX].join('\n')
  assert.equal(authStateFromCapture(cap).broken, false)
})

test('报错之后哪怕只回了一个字，也立刻认回来（以前要靠长回复把报错顶出最后 20 行）', () => {
  const cap = ['❯ 【阿颖】成功在10点之前起床！', '', ...ERR, '', '❯ 老公？', '', '● 在。', ...BOX].join('\n')
  assert.equal(authStateFromCapture(cap).broken, false)
})

test('探针也换来报错：重新卡住', () => {
  const cap = ['❯ 【阿颖】第一条', '', ...ERR, '', '❯ 【阿颖】第二条', '', ...ERR, ...BOX].join('\n')
  assert.equal(authStateFromCapture(cap).broken, true)
})

test('屏幕上没有报错、或者报错只是工具输出里引用的一行，都不算', () => {
  assert.equal(authStateFromCapture(['❯ 你好', '', '● 你好呀', ...BOX].join('\n')).broken, false)
  const quoted = ['❯ 查日志', '', '● 我去看看', '  ⎿  16:● Please run /login · API Error: 403', '', '● 查到了，是这一行', ...BOX].join('\n')
  assert.equal(authStateFromCapture(quoted).broken, false)
})

test('输入框里正打着字不算交上去的话', () => {
  const typing = ['', RULE, '❯ 还没发出去的半句', RULE, '  [Opus 5.5]']
  const cap = ['❯ 【阿颖】第一条', '', ...ERR, ...typing].join('\n')
  assert.equal(authStateFromCapture(cap).broken, true)
})

test('保质期：卡住先拦，三分钟后放一条探针，探不通就 6、12 分钟地退避；好了就清零', () => {
  const gate = createAuthGate()
  const m = 60000
  assert.deepEqual(gate.observe(true, 0), { blocked: true, probe: false })
  assert.equal(gate.minutesUntilProbe(m), 2)
  assert.deepEqual(gate.observe(true, 3 * m), { blocked: false, probe: true })
  gate.probed(3 * m)
  assert.deepEqual(gate.observe(true, 4 * m), { blocked: true, probe: false })
  assert.deepEqual(gate.observe(true, 9 * m), { blocked: false, probe: true })
  gate.probed(9 * m)
  assert.equal(gate.observe(true, 20 * m).blocked, true)
  assert.equal(gate.observe(true, 21 * m).probe, true)
  assert.deepEqual(gate.observe(false, 22 * m), { blocked: false, probe: false })
  assert.equal(gate.stuckSince(), 0)
  assert.deepEqual(gate.observe(true, 30 * m), { blocked: true, probe: false })
})
