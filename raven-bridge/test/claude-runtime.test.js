const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { contextSnapshot, modelCatalog, validModel, refreshOfficialModels } = require('../claude-runtime')

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-runtime-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

test('context usage uses the real window size from the active status snapshot', t => {
  const root = temp(t)
  const file = path.join(root, 'usage.json')
  fs.writeFileSync(file, JSON.stringify({ available: true, model: 'claude-test', context_used_percent: 25, context_window_size: 320000, updated_at: 1000 }))
  assert.deepEqual(contextSnapshot(file, 1005_000), {
    pct: 25, tokens: 80000, contextWindow: 320000, model: 'claude-test', ageSeconds: 5, stale: false, source: 'claude_statusline',
  })
})

test('model catalog uses current aliases and account options instead of stale project history', t => {
  const root = temp(t)
  const stateFile = path.join(root, 'state.json')
  const settingsFile = path.join(root, 'settings.json')
  const usageFile = path.join(root, 'usage.json')
  fs.writeFileSync(stateFile, JSON.stringify({
    additionalModelOptionsCache: [{ value: 'claude-fable-5-1[1m]', label: 'Fable', description: 'Fable 5.1 · Most capable' }],
    projects: { one: { lastModelUsage: { 'recent-model': { inputTokens: 1 } } } },
  }))
  fs.writeFileSync(settingsFile, JSON.stringify({ model: 'configured-model' }))
  fs.writeFileSync(usageFile, JSON.stringify({ model: 'active-model' }))
  assert.deepEqual(modelCatalog({ stateFile, settingsFile, usageFile }).map(item => item.id), [
    'default', 'opus', 'sonnet', 'haiku', 'active-model', 'configured-model', 'claude-fable-5-1[1m]',
    // 订阅还能跑的历史版本，排在最后（1004）
    'claude-opus-5', 'claude-opus-4-6', 'claude-opus-4-5-20251101',
    'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001',
  ])
  assert.equal(modelCatalog({ stateFile, settingsFile, usageFile }).find(item => item.id === 'claude-fable-5-1[1m]').label, 'Fable 5.1')
  assert.equal(modelCatalog({ stateFile, settingsFile, usageFile }).some(item => item.id === 'recent-model'), false)
  assert.equal(validModel('opus; touch /tmp/no'), false)
})

test('model catalog prefers the official account list over the hand-written legacy list', t => {
  const root = temp(t)
  const stateFile = path.join(root, 'state.json')
  fs.writeFileSync(stateFile, JSON.stringify({}))
  const officialList = [{ id: 'claude-sonnet-9', label: 'Sonnet 9' }, { id: 'claude-opus-4-6', label: 'Opus 4.6' }]
  const ids = modelCatalog({ stateFile, settingsFile: path.join(root, 'none.json'), usageFile: path.join(root, 'none.json'), officialList }).map(m => m.id)
  assert.deepEqual(ids.slice(-2), ['claude-sonnet-9', 'claude-opus-4-6'])
  assert.equal(ids.includes('claude-sonnet-4-5-20250929'), false)
})

test('refreshOfficialModels reads the oauth token server-side and strips the Claude prefix', async t => {
  const root = temp(t)
  const creds = path.join(root, 'creds.json')
  fs.writeFileSync(creds, JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } }))
  let seen = null
  const list = await refreshOfficialModels(creds, async (url, opts) => { seen = { url, auth: opts.headers.Authorization }; return { ok: true, json: async () => ({ data: [{ id: 'claude-opus-9', display_name: 'Claude Opus 9' }, { id: 'bad id;' }] }) } })
  assert.equal(seen.url.startsWith('https://api.anthropic.com/v1/models'), true)
  assert.equal(seen.auth, 'Bearer tok')
  assert.deepEqual(list, [{ id: 'claude-opus-9', label: 'Opus 9' }])
})
