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
  // 1114 她说切模型「要点好几下」：/model 敲进终端就生效了，但状态栏要等下一条回复才报新模型，
  // 确认时读到的还是旧的，勾选又跳回旧模型，看着像没切成，她只好再点一遍。
  // 记下刚切的那个，状态栏跟上之前（最多 15 分钟）都按它显示
  let pendingSwitch = null
  let pickedAt = 0
  function applyModelData(data, keepSelection = false) {
    if (pendingSwitch && (modelMatchesSelection(data.currentModel, pendingSwitch.model) || Date.now() - pendingSwitch.at > 15 * 60000)) pendingSwitch = null
    const age = Number(data.currentModelAgeSeconds)
    currentModel.textContent = data.currentModel
      ? prettyModel(data.currentModel) + (prettyModel(data.currentModel) !== data.currentModel ? '（' + data.currentModel + '）' : '')
        + (pendingSwitch ? ' → 已切到 ' + prettyModel(pendingSwitch.model) + '，下一条回复起用它'
          : age > 120 ? ' · ' + Math.round(age / 60) + ' 分钟前的状态，刚切换的话等下一条回复后刷新' : '')
      : '未知'
    const selected = pendingSwitch ? pendingSwitch.model : keepSelection ? modelSelect.value : ''
    modelSelect.replaceChildren()
    for (const model of Array.isArray(data.models) ? data.models : []) {
      const option = document.createElement('option')
      option.value = model.id
      const label = model.label === model.id ? prettyModel(model.id) : model.label
      option.textContent = label + (model.id === data.currentModel ? '（正在用）' : '')
      option.dataset.source = model.source || ''
      option.dataset.label = label
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
    if (!keepSelection) showAll = false
    renderModelList(data.currentModel)
    renderEffort(data)
  }
  // 1004：系统下拉框在手机上是一块白底弹窗，跟归巢不搭（她说「有鸟为了图省事用的系统框」）。
  // 换成页面里自己画的列表，select 藏起来继续当数据源；历史版本单独一组
  const modelList = document.getElementById('cc-model-list')
  // 1110 她说这页「好长呀」：常用的排成两列，名字缩短；全部版本收成一行，点了才展开
  let showAll = false
  const shortLabel = o => o.dataset.source === 'alias'
    ? (o.dataset.label || '').replace('（Claude Code 推荐）', '').replace('（自动使用最新版本）', ' 最新')
    : (o.dataset.label || o.textContent)
  function renderModelList(current) {
    if (!modelList) return
    modelList.replaceChildren()
    const isAll = o => o.dataset.source === 'official' || o.dataset.source === 'legacy'
    const opts = [...modelSelect.options].filter(o => o.value)
    const grid = list => {
      const g = document.createElement('div'); g.className = 'cc-model-grid'
      for (const o of list) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'cc-model-item'; b.title = o.value
        if (o.value === modelSelect.value) b.classList.add('on')
        const name = document.createElement('span'); name.textContent = shortLabel(o)
        b.append(name)
        const tagText = pendingSwitch ? (o.value === pendingSwitch.model ? '已切到' : '') : (o.value === current ? '正在用' : '')
        if (tagText) { const tag = document.createElement('em'); tag.textContent = tagText; b.append(tag) }
        b.onclick = () => { pickedAt = Date.now(); modelSelect.value = o.value; modelSelect.onchange && modelSelect.onchange(); renderModelList(current) }
        g.append(b)
      }
      return g
    }
    const common = opts.filter(o => !isAll(o)), rest = opts.filter(isAll)
    if (common.length) modelList.append(grid(common))
    if (!rest.length) return
    const picked = rest.find(o => o.value === modelSelect.value)
    const more = document.createElement('button'); more.type = 'button'; more.className = 'cc-model-more'
    more.setAttribute('aria-expanded', String(showAll))
    const text = document.createElement('span')
    text.textContent = '全部版本 · ' + rest.length + ' 个' + (picked && !showAll ? '（选了 ' + shortLabel(picked) + '）' : '')
    const arrow = document.createElement('span'); arrow.textContent = showAll ? '收起 ▴' : '展开 ▾'
    more.append(text, arrow)
    more.onclick = () => { showAll = !showAll; renderModelList(current) }
    modelList.append(more)
    if (showAll) modelList.append(grid(rest))
  }
  // 1110 思考程度：终端里的 /effort。点一下就发，亮着的是状态栏报上来的当前档
  const effortBlock = document.getElementById('cc-effort-block')
  const effortList = document.getElementById('cc-effort-list')
  const effortNow = document.getElementById('cc-current-effort')
  const EFFORT_NAMES = { auto: '自动', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大' }
  let effortTimer = null
  function renderEffort(data) {
    if (!effortBlock) return
    const list = Array.isArray(data.efforts) ? data.efforts : []
    effortBlock.hidden = !list.length
    effortNow.textContent = EFFORT_NAMES[data.effort] || '未知'
    effortList.replaceChildren()
    for (const level of list) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'cc-effort-item'
      b.textContent = EFFORT_NAMES[level] || level
      if (level === data.effort) b.classList.add('on')
      b.disabled = busy
      b.onclick = () => run(async () => {
        say('正在切换思考程度…')
        await api({}, { kind: 'effort-switch', effort: level })
        say('指令已发送，正在等 Claude Code 确认…')
        confirmEffort(level)
      })
      effortList.append(b)
    }
  }
  function confirmEffort(expected, attempt = 0) {
    clearTimeout(effortTimer)
    effortTimer = setTimeout(async () => {
      try {
        const data = await api({ kind: 'model' })
        applyModelData(data, true)
        const now = EFFORT_NAMES[data.effort] || ''
        // 「自动」是把档位交回给 CC 自己定，状态栏只会报它定成了哪一档
        if (expected === 'auto' && attempt >= 1) { say('已交回自动' + (now ? '，现在是「' + now + '」' : '')); return }
        if (data.effort === expected) { say('思考程度已切到「' + now + '」'); return }
        if (attempt < 2) { confirmEffort(expected, attempt + 1); return }
        say(now ? '指令已发送；状态栏报的还是「' + now + '」，这个模型可能不支持那一档，或者等下一条回复后再看。' : '指令已发送；状态栏还没报档位，等下一条回复后再看。')
      } catch (e) { say(e.message) }
    }, attempt === 0 ? 1800 : 2500)
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
        say('已经切到 ' + expected + ' 了，不用再点。状态栏要等下一条回复才会跟上。')
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
    const openedAt = Date.now()
    if (revision !== null) { run(async () => { applyModelData(await api({ kind: 'model' }), pickedAt > openedAt) }); return }
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
      pendingSwitch = { model, at: Date.now() }
      // 别名也要等确认：以前别名直接说「已选择」就收工，指令被吞了也看不出来（0926）
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
