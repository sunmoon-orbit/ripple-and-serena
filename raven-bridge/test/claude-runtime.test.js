const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { contextSnapshot, modelCatalog, validModel } = require('../claude-runtime')

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

test('model catalog is populated from Claude state instead of a fixed list', t => {
  const root = temp(t)
  const stateFile = path.join(root, 'state.json')
  const settingsFile = path.join(root, 'settings.json')
  const usageFile = path.join(root, 'usage.json')
  fs.writeFileSync(stateFile, JSON.stringify({
    additionalModelOptionsCache: [{ value: 'cached-model', label: 'Cached model' }],
    projects: { one: { lastModelUsage: { 'recent-model': { inputTokens: 1 } } } },
  }))
  fs.writeFileSync(settingsFile, JSON.stringify({ model: 'configured-model' }))
  fs.writeFileSync(usageFile, JSON.stringify({ model: 'active-model' }))
  assert.deepEqual(modelCatalog({ stateFile, settingsFile, usageFile }).map(item => item.id), [
    'active-model', 'configured-model', 'cached-model', 'recent-model',
  ])
  assert.equal(validModel('opus; touch /tmp/no'), false)
})
