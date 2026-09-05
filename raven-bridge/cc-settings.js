// Authenticated, fixed-path editing. Never accepts a filesystem path from the client.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { modelCatalog, validModel } = require('./claude-runtime')
const MAX_BYTES = 256 * 1024
const hash = s => crypto.createHash('sha256').update(s).digest('hex')
const fail = (status, message) => Object.assign(new Error(message), { status })

function createStore({ project, home, backups, claudeState = path.join(home, '.claude.json'), usageSnapshot = path.join(home, '.claude', 'rate_limits_latest.json') }) {
  const targets = {
    project: path.join(project, 'CLAUDE.md'),
    global: path.join(home, '.claude', 'CLAUDE.md'),
    model: path.join(project, '.claude', 'settings.local.json'),
  }
  function target(key) {
    if (!Object.hasOwn(targets, key)) throw fail(400, '请选择全局或项目文件')
    const file = targets[key]
    // Reject symlinks in both the file and any existing parent.
    for (let p = file; p !== path.dirname(p); p = path.dirname(p)) {
      try { if (fs.lstatSync(p).isSymbolicLink()) throw fail(409, '文件使用了链接，请先在服务器确认位置') }
      catch (e) { if (e.code !== 'ENOENT') throw e }
    }
    return file
  }
  function read(key) {
    const file = target(key)
    let content = '', exists = false
    try {
      if (fs.statSync(file).size > MAX_BYTES) throw fail(413, '文件太大，暂不支持在线编辑')
      content = fs.readFileSync(file, 'utf8'); exists = true
    } catch (e) { if (e.code !== 'ENOENT') throw e }
    return { content, exists, revision: hash((exists ? '1:' : '0:') + content) }
  }
  function save(key, content, revision) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_BYTES) throw fail(400, '内容无效或超过大小限制')
    const old = read(key)
    if (old.revision !== revision) throw fail(409, '文件已被其他窗口修改，请保留草稿并重新读取')
    const file = target(key)
    fs.mkdirSync(backups, { recursive: true, mode: 0o700 })
    if (old.exists) fs.writeFileSync(path.join(backups, `${key}-${Date.now()}-${crypto.randomUUID()}.bak`), old.content, { mode: 0o600, flag: 'wx' })
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const temp = `${file}.${crypto.randomUUID()}.tmp`
    try {
      fs.writeFileSync(temp, content, { mode: old.exists ? fs.statSync(file).mode & 0o777 : 0o600, flag: 'wx' })
      if (read(key).revision !== revision) throw fail(409, '保存时文件发生变化，请重新读取')
      fs.renameSync(temp, file)
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
    return read(key)
  }
  function model() {
    const item = read('model')
    const settings = item.exists ? JSON.parse(item.content) : {}
    if (!settings || Array.isArray(settings) || typeof settings !== 'object') throw fail(409, '模型配置格式不正确')
    return { settings, item }
  }
  return {
    readDocument(scope) { if (!['project', 'global'].includes(scope)) throw fail(400, '未知范围'); return read(scope) },
    saveDocument(scope, content, revision) { if (!['project', 'global'].includes(scope)) throw fail(400, '未知范围'); return save(scope, content, revision) },
    readModel() {
      const { settings, item } = model()
      const snapshot = (() => { try { return JSON.parse(fs.readFileSync(usageSnapshot, 'utf8')) } catch { return null } })()
      return {
        model: settings.model || '',
        currentModel: validModel(snapshot?.model) ? snapshot.model : '',
        models: modelCatalog({ stateFile: claudeState, settingsFile: targets.model, usageFile: usageSnapshot }),
        revision: item.revision,
        applies: 'next_session',
      }
    },
    saveModel(value, revision) {
      if (typeof value !== 'string' || (value && !/^[a-zA-Z0-9][a-zA-Z0-9._:[\]-]{0,159}$/.test(value))) throw fail(400, '模型名称无效')
      const { settings } = model()
      if (value) settings.model = value; else delete settings.model
      save('model', JSON.stringify(settings, null, 2) + '\n', revision)
      return this.readModel()
    },
  }
}

function createHandler(store, authenticate, { switchModel } = {}) {
  return async function handle(req, res, url) {
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(data))
    }
    const token = (req.headers.authorization || '').replace(/^Bearer /, '')
    if (!authenticate(token)) { send(401, { error: '请先登录归巢' }); return }
    try {
      if (req.method === 'GET') {
        send(200, url.searchParams.get('kind') === 'model' ? store.readModel() : store.readDocument(url.searchParams.get('scope') || 'project'))
        return
      }
      if (req.method !== 'POST') { send(405, { error: '不支持的操作' }); return }
      let bytes = 0; const chunks = []
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > MAX_BYTES * 2) { send(413, { error: '请求太大' }); return }
        chunks.push(chunk)
      }
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw fail(400, '请求格式不正确') }
      if (!body || typeof body !== 'object') throw fail(400, '请求格式不正确')
      let data
      if (body.kind === 'model-switch') {
        if (!validModel(body.model)) throw fail(400, '模型名称无效')
        if (typeof switchModel !== 'function' || !switchModel(body.model)) throw fail(409, '当前没有可接收切换指令的 Claude Code 会话')
        data = { model: body.model, applied: 'current_session', queued: true }
      } else {
        data = body.kind === 'model' ? store.saveModel(body.model, body.revision) : store.saveDocument(body.scope, body.content, body.revision)
      }
      send(200, data)
    } catch (e) { send(e.status || 500, { error: e.status ? e.message : '读取或保存失败，请稍后重试；原文件未被主动删除' }) }
  }
}
module.exports = { createStore, createHandler }
