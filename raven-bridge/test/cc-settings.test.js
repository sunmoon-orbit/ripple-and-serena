const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Readable } = require('stream')
const { createStore, createHandler } = require('../cc-settings')
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-settings-test-'))
  const project = path.join(root, 'project'), home = path.join(root, 'home'), backups = path.join(root, 'backups')
  fs.mkdirSync(project); fs.mkdirSync(home)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const claudeState = path.join(root, 'claude-state.json'), usageSnapshot = path.join(root, 'usage.json')
  return { root, project, home, backups, claudeState, usageSnapshot, store: createStore({ project, home, backups, claudeState, usageSnapshot }) }
}
async function request(handler, { method = 'GET', token = '', body, query = '' } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  req.method = method
  req.headers = { authorization: token ? `Bearer ${token}` : '' }
  let status, headers, text
  const res = {
    writeHead(code, nextHeaders) { status = code; headers = nextHeaders },
    end(value = '') { text = value },
  }
  await handler(req, res, new URL(`/raven/cc-settings${query}`, 'http://localhost'))
  return { status, headers, body: JSON.parse(text) }
}
test('document edits preserve originals and reject stale edits and arbitrary paths', t => {
  const { store, backups } = fixture(t)
  const first = store.readDocument('project')
  assert.equal(first.exists, false)
  const next = store.saveDocument('project', '# 原文\n', first.revision)
  store.saveDocument('project', '# 新版\n', next.revision)
  assert.throws(() => store.saveDocument('project', '覆盖', next.revision), { status: 409 })
  assert.equal(fs.readFileSync(path.join(backups, fs.readdirSync(backups)[0]), 'utf8'), '# 原文\n')
  assert.throws(() => store.readDocument('../secret'), { status: 400 })
})
test('model changes preserve hooks and permissions; global config stays untouched', t => {
  const { store, project, home } = fixture(t)
  fs.mkdirSync(path.join(project, '.claude'))
  const file = path.join(project, '.claude/settings.local.json')
  const settings = { permissions: { deny: ['Bash(rm:*)'] }, hooks: { Stop: [] }, model: 'sonnet' }
  fs.writeFileSync(file, JSON.stringify(settings))
  const before = store.readModel()
  store.saveModel('opus', before.revision)
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { ...settings, model: 'opus' })
  assert.equal(fs.existsSync(path.join(home, '.claude/settings.json')), false)
  assert.throws(() => store.saveModel('opus; rm -rf /', store.readModel().revision), { status: 400 })
})
test('symlink files cannot be edited through the panel', t => {
  const { store, project, root } = fixture(t)
  const other = path.join(root, 'other'); fs.writeFileSync(other, 'untouched')
  fs.symlinkSync(other, path.join(project, 'CLAUDE.md'))
  assert.throws(() => store.readDocument('project'), { status: 409 })
  assert.equal(fs.readFileSync(other, 'utf8'), 'untouched')
})
test('HTTP requires login even on localhost and supports round-trip save', async t => {
  const { store } = fixture(t)
  const handler = createHandler(store, token => token === 'fixture-only')
  assert.equal((await request(handler)).status, 401)
  const first = (await request(handler, { token: 'fixture-only' })).body
  const response = await request(handler, { method: 'POST', token: 'fixture-only', body: JSON.stringify({ scope: 'project', content: 'hello', revision: first.revision }) })
  assert.equal(response.status, 200)
  assert.equal(response.body.content, 'hello')
  assert.equal((await request(handler, { method: 'POST', token: 'fixture-only', body: '{' })).status, 400)
})
test('HTTP can queue a validated model switch without changing the saved default', async t => {
  const { store } = fixture(t)
  const switched = []
  const handler = createHandler(store, token => token === 'fixture-only', { switchModel: value => { switched.push(value); return true } })
  const response = await request(handler, { method: 'POST', token: 'fixture-only', body: JSON.stringify({ kind: 'model-switch', model: 'claude-current' }) })
  assert.equal(response.status, 200)
  assert.deepEqual(switched, ['claude-current'])
  assert.equal(store.readModel().model, '')
  assert.equal((await request(handler, { method: 'POST', token: 'fixture-only', body: JSON.stringify({ kind: 'model-switch', model: 'bad model' }) })).status, 400)
})
test('HTTP refuses to type a model command while Claude Code is replying', async t => {
  const { store } = fixture(t)
  const switched = []
  const handler = createHandler(store, token => token === 'fixture-only', {
    canSwitchModel: () => false,
    switchModel: value => { switched.push(value); return true },
  })
  const response = await request(handler, { method: 'POST', token: 'fixture-only', body: JSON.stringify({ kind: 'model-switch', model: 'claude-sonnet-4-6' }) })
  assert.equal(response.status, 409)
  assert.match(response.body.error, /当前回复结束/)
  assert.deepEqual(switched, [])
})
test('effort level comes from the statusline snapshot and only known levels can be typed', async t => {
  const { store, usageSnapshot } = fixture(t)
  assert.equal(store.readModel().effort, '')
  fs.writeFileSync(usageSnapshot, JSON.stringify({ model: 'claude-current', effort: 'xhigh', updated_at: Math.floor(Date.now() / 1000) }))
  assert.equal(store.readModel().effort, 'xhigh')
  fs.writeFileSync(usageSnapshot, JSON.stringify({ model: 'claude-current', effort: 'high; rm -rf /' }))
  assert.equal(store.readModel().effort, '')
  const typed = []
  const handler = createHandler(store, token => token === 'fixture-only', { switchEffort: value => { typed.push(value); return true } })
  const ok = await request(handler, { method: 'POST', token: 'fixture-only', body: JSON.stringify({ kind: 'effort-switch', effort: 'max' }) })
  assert.equal(ok.status, 200)
  assert.equal((await request(handler, { method: 'POST', token: 'fixture-only', body: JSON.stringify({ kind: 'effort-switch', effort: 'max\n/model opus' }) })).status, 400)
  assert.equal((await request(handler, { method: 'POST', token: 'fixture-only', body: JSON.stringify({ kind: 'effort-switch' }) })).status, 400)
  assert.deepEqual(typed, ['max'])
})
test('HTTP refuses to type an effort command while Claude Code is replying', async t => {
  const { store } = fixture(t)
  const typed = []
  const handler = createHandler(store, token => token === 'fixture-only', { canSwitchModel: () => false, switchEffort: value => { typed.push(value); return true } })
  const response = await request(handler, { method: 'POST', token: 'fixture-only', body: JSON.stringify({ kind: 'effort-switch', effort: 'low' }) })
  assert.equal(response.status, 409)
  assert.match(response.body.error, /当前回复结束/)
  assert.deepEqual(typed, [])
})
