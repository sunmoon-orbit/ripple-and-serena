(() => {
  const dialog = document.getElementById('cc-settings-dialog')
  const editor = document.getElementById('cc-document')
  const scope = document.getElementById('cc-scope')
  const status = document.getElementById('cc-settings-status')
  const model = document.getElementById('cc-model')
  const preview = document.getElementById('cc-preview')
  let revision = null, modelRevision = null, original = '', activeScope = 'project', busy = false
  const say = text => { status.textContent = text }
  function lock(value) {
    busy = value
    dialog.querySelectorAll('button,select,input,textarea').forEach(el => { el.disabled = value })
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
    if (revision !== null) return
    run(async () => {
      say('正在读取…')
      const data = await api({ kind: 'model' })
      model.value = data.model; modelRevision = data.revision
      await loadDocument()
    })
  }
  document.getElementById('cc-settings-close').onclick = () => dialog.close()
  dialog.addEventListener('cancel', e => { if (busy) e.preventDefault() })
  scope.onchange = () => {
    if (editor.value !== original && !confirm('切换文件会放弃当前未保存的修改，继续吗？')) { scope.value = activeScope; return }
    run(async () => { try { await loadDocument() } catch (e) { scope.value = activeScope; throw e } })
  }
  editor.oninput = () => { renderPreview(); say('有未保存的修改') }
  document.getElementById('cc-reload').onclick = () => {
    if (editor.value !== original && !confirm('重新读取会放弃当前草稿，继续吗？')) return
    run(async () => {
      const data = await api({ kind: 'model' }); model.value = data.model; modelRevision = data.revision
      await loadDocument()
    })
  }
  document.getElementById('cc-document-save').onclick = () => run(async () => {
    if (!revision) throw new Error('请先成功读取文件')
    const data = await api({}, { scope: activeScope, content: editor.value, revision })
    original = data.content; revision = data.revision
    say('已保存，旧版已备份。新会话会读取这份说明；当前会话不保证立即重载。')
  })
  document.getElementById('cc-model-save').onclick = () => run(async () => {
    if (!modelRevision) throw new Error('请先点击重新读取')
    const data = await api({}, { kind: 'model', model: model.value.trim(), revision: modelRevision })
    modelRevision = data.revision
    say('默认模型已保存，下次从本项目启动 CC 时使用；启动参数或组织策略可能覆盖它。')
  })
  document.getElementById('cc-preview-toggle').onclick = () => {
    const visible = preview.hidden
    preview.hidden = !visible; editor.hidden = visible
    document.getElementById('cc-preview-toggle').textContent = visible ? '返回编辑' : '阅读预览'
  }
  window.addEventListener('beforeunload', e => { if (editor.value !== original) { e.preventDefault(); e.returnValue = '' } })
})()
