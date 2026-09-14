const fs = require('fs')

function modelView(m) {
  return { id: m.id, model: m.model, displayName: m.displayName,
    supportedReasoningEfforts: m.supportedReasoningEfforts || [],
    defaultReasoningEffort: m.defaultReasoningEffort,
    inputModalities: m.inputModalities || ['text', 'image'], isDefault: !!m.isDefault }
}

function createModelControls(adapter, stateFile) {
  let models = null
  let loading = null
  let choices = {}
  if (stateFile) { try { choices = JSON.parse(fs.readFileSync(stateFile, 'utf8')) } catch {} }
  return {
    async list(refresh = false) {
      if (models && !refresh) return models
      if (loading) return loading
      loading = (async () => {
        const found = [], seen = new Set()
        let cursor = null
        do {
          const page = await adapter.request('model/list', { limit: 50, includeHidden: false, cursor })
          for (const m of page.data || []) if (!m.hidden && m.id && m.model) found.push(modelView(m))
          cursor = page.nextCursor || null
          if (cursor && seen.has(cursor)) throw new Error('模型列表分页游标重复')
          seen.add(cursor)
        } while (cursor)
        models = [...new Map(found.map(m => [m.id, m])).values()]
        return models
      })()
      try { return await loading } finally { loading = null }
    },
    async validate(choice) {
      const catalog = await this.list()
      const entry = catalog.find(m => m.model === choice?.model || m.id === choice?.model)
      if (!entry) throw new Error('模型不可用，请刷新模型列表重新选择')
      const effort = choice.effort || entry.defaultReasoningEffort
      if (!entry.supportedReasoningEfforts.some(e => e.reasoningEffort === effort)) throw new Error('该模型不支持所选推理强度')
      return { model: entry.model, effort, inputModalities: entry.inputModalities }
    },
    remembered(id) { return choices[id] },
    remember(id, choice) {
      choices[id] = { model: choice.model, effort: choice.effort }
      if (stateFile) {
        fs.writeFileSync(stateFile + '.tmp', JSON.stringify(choices), { mode: 0o600 })
        fs.renameSync(stateFile + '.tmp', stateFile)
      }
    },
  }
}

function threadOverrides(choice) {
  return choice ? { model: choice.model, config: { model_reasoning_effort: choice.effort } } : {}
}
function confirmedModel(result) {
  return { model: result.model ?? result.thread?.model ?? null,
    reasoningEffort: result.reasoningEffort ?? result.thread?.reasoningEffort ?? null }
}
module.exports = { createModelControls, modelView, threadOverrides, confirmedModel }
