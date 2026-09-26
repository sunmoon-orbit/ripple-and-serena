(() => {
  const dialog = document.getElementById('cc-settings-dialog')
  const editor = document.getElementById('cc-document')
  const scope = document.getElementById('cc-scope')
  const status = document.getElementById('cc-settings-status')
  const currentModel = document.getElementById('cc-current-model')
  const modelSelect = document.getElementById('cc-model-select')
  const modelApply = document.getElementById('cc-model-apply')
  const preview = document.getElementById('cc-preview')
  let revision = null, original = '', activeScope = 'project', busy = false, modelRefreshTimer = null
  const say = text => { status.textContent = text }
  function lock(value) {
    busy = value
    dialog.querySelectorAll('button,select,input,textarea').forEach(el => { el.disabled = value })
    if (!value) modelApply.disabled = !modelSelect.value
  }
  async function api(params, body) {
    const response = await fetch('/raven/cc-settings?' + new URLSearchParams(params), {
      method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { Authorization: 'Bearer ' + (localStorage.getItem('raven-token') || ''), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    let data
    try { data = await response.json() } catch { throw new Error('设置接口尚未就绪，请确认桥接服务已更新') }
    if (!response.ok) throw new Error(data.error || '请求失败')
    return data
  }
  function renderPreview() {
    // textContent only: CLAUDE.md is untrusted text, never executable HTML.
    preview.replaceChildren()
    for (const line of editor.value.split('\n')) {
      const heading = line.match(/^(#{1,3})\s+(.*)$/)
      const el = document.createElement(heading ? 'h' + heading[1].length : 'div')
      el.textContent = heading ? heading[2] : line || '\u00a0'
      preview.append(el)
    }
  }
  // claude-opus-5-5 → Opus 5.5；认不出的原样返回
  function prettyModel(id) {
    const m = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?(\[1m\])?$/.exec(id || '')
    return m ? m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + '.' + m[3] + (m[4] ? '（1M 上下文）' : '') : (id || '')
  }
  // keepSelection：只有「刷新列表」保留她手上正在挑的那项；
  // 每次打开面板都回到「实际在跑的那个」，不然勾选和（当前）会指着两行（0926 阿颖：怪怪的）
  function applyModelData(data, keepSelection = false) {
    const age = Number(data.currentModelAgeSeconds)
    currentModel.textContent = data.currentModel
      ? prettyModel(data.currentModel) + (prettyModel(data.currentModel) !== data.currentModel ? '（' + data.currentModel + '）' : '')
        + (age > 120 ? ' · ' + Math.round(age / 60) + ' 分钟前的状态，刚切换的话等下一条回复后刷新' : '')
      : '未知'
    const selected = keepSelection ? modelSelect.value : ''
    modelSelect.replaceChildren()
    for (const model of Array.isArray(data.models) ? data.models : []) {
      const option = document.createElement('option')
      option.value = model.id
      const label = model.label === model.id ? prettyModel(model.id) : model.label
      option.textContent = label + (model.id === data.currentModel ? '（正在用）' : '')
      modelSelect.append(option)
    }
    if (!modelSelect.options.length) {
      const option = document.createElement('option')
      option.value = ''
      option.textContent = '暂未读取到可用模型'
      modelSelect.append(option)
    }
    const preferred = [selected, data.currentModel, data.model].find(value => value && [...modelSelect.options].some(option => option.value === value))
    modelSelect.value = preferred || modelSelect.options[0].value
    modelApply.disabled = busy || !modelSelect.value
  }
  function modelMatchesSelection(actual, selected) {
    if (!actual || !selected) return false
    if (actual === selected) return true
    if (['opus', 'sonnet', 'haiku', 'fable'].includes(selected)) return actual.startsWith('claude-' + selected + '-')
    return selected === 'default'
  }
  function confirmModelSwitch(expected, attempt = 0) {
    clearTimeout(modelRefreshTimer)
    modelRefreshTimer = setTimeout(async () => {
      try {
        const data = await api({ kind: 'model' })
        applyModelData(data)
        if (modelMatchesSelection(data.currentModel, expected)) { say('已切换到 ' + expected); return }
        if (attempt < 2) { confirmModelSwitch(expected, attempt + 1); return }
        say('切换指令已发送；状态栏还没确认，下一条消息前可再刷新一次。')
      } catch (e) { say(e.message) }
    }, attempt === 0 ? 1800 : 2500)
  }
  async function loadDocument() {
    const data = await api({ scope: scope.value })
    revision = data.revision; original = data.content; editor.value = data.content; activeScope = scope.value
    renderPreview()
    say(data.exists ? '已读取。修改后点击保存；保存前会保留旧版。' : '这份文件还不存在，保存后创建。')
  }
  async function run(action) {
    if (busy) return
    lock(true)
    try { await action() } catch (e) { say(e.message) } finally { lock(false) }
  }
  document.getElementById('cc-settings-open').onclick = () => {
    dialog.showModal()
    // 模型状态每次打开都重读（以前只读第一次，关了再开永远是旧的）；文档草稿不动
    if (revision !== null) { run(async () => { applyModelData(await api({ kind: 'model' })) }); return }
    run(async () => {
      say('正在读取…')
      const data = await api({ kind: 'model' })
      applyModelData(data)
      await loadDocument()
    })
  }
  document.getElementById('cc-settings-close').onclick = () => dialog.close()
  modelSelect.onchange = () => { modelApply.disabled = busy || !modelSelect.value }
  modelApply.onclick = () => {
    const model = modelSelect.value
    if (!model) return
    run(async () => {
      say('正在切换模型…')
      await api({}, { kind: 'model-switch', model })
      if (['default', 'opus', 'sonnet', 'haiku', 'fable'].includes(model)) {
        say('已选择 ' + model + '（最新可用版本）；下一条回复后会显示实际模型。')
        return
      }
      say('切换指令已发送，正在等 Claude Code 确认…')
      confirmModelSwitch(model)
    })
  }
  document.getElementById('cc-model-reload').onclick = () => run(async () => {
    say('正在刷新模型列表…')
    applyModelData(await api({ kind: 'model' }), true)
    say('模型列表已刷新。')
  })
  dialog.addEventListener('cancel', e => { if (busy) e.preventDefault() })
  scope.onchange = () => {
    if (editor.value !== original && !confirm('切换文件会放弃当前未保存的修改，继续吗？')) { scope.value = activeScope; return }
    run(async () => { try { await loadDocument() } catch (e) { scope.value = activeScope; throw e } })
  }
  editor.oninput = () => { renderPreview(); say('有未保存的修改') }
  document.getElementById('cc-reload').onclick = () => {
    if (editor.value !== original && !confirm('重新读取会放弃当前草稿，继续吗？')) return
    run(async () => {
      const data = await api({ kind: 'model' }); applyModelData(data)
      await loadDocument()
    })
  }
  document.getElementById('cc-document-save').onclick = () => run(async () => {
    if (!revision) throw new Error('请先成功读取文件')
    const data = await api({}, { scope: activeScope, content: editor.value, revision })
    original = data.content; revision = data.revision
    say('已保存，旧版已备份。新会话会读取这份说明；当前会话不保证立即重载。')
  })
  document.getElementById('cc-preview-toggle').onclick = () => {
    const visible = preview.hidden
    preview.hidden = !visible; editor.hidden = visible
    document.getElementById('cc-preview-toggle').textContent = visible ? '返回编辑' : '阅读预览'
  }
  window.addEventListener('beforeunload', e => { if (editor.value !== original) { e.preventDefault(); e.returnValue = '' } })
})()
