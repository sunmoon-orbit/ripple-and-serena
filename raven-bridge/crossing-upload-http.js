const MAX_BODY = 6 * 1024 * 1024
const { validateToolRequest } = require('./crossing-tool-http')
function handleUpload(req, res, store, authenticated = () => false, actions = {}) {
  const reply = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(data)) }
  if (!authenticated(req)) { reply(401, { error: 'unauthorized' }); req.resume(); return }
  if (String(req.headers['content-type']).split(';')[0].trim() !== 'application/json') { reply(415, { error: '需要 JSON 附件数据' }); req.resume(); return }
  let size = 0, rejected = false
  const chunks = []
  req.on('data', chunk => {
    size += chunk.length
    if (size > MAX_BODY) { if (!rejected) reply(413, { error: '附件超过大小限制' }); rejected = true; chunks.length = 0; return }
    if (!rejected) chunks.push(chunk)
  })
  req.on('end', async () => {
    if (rejected) return
    try {
      const session = authenticated(req)
      if (!session) { reply(401, { error: 'unauthorized' }); return }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (body.action === 'logout') { actions.revoke?.(session.id); reply(200, { ok: true }); return }
      if (body.action === 'tool') {
        if (!actions.tool) { reply(403, { error: 'unauthorized' }); return }
        const input = validateToolRequest(body)
        const result = await actions.tool(input)
        if (!authenticated(req)) { reply(401, { error: 'unauthorized' }); return }
        reply(result.status, result.status >= 200 && result.status < 300 ? result.data : { error: 'request failed' }); return
      }
      if (body.action === 'tts') {
        if (!actions.tts || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 500) { reply(400, { error: 'invalid request' }); return }
        const result = await actions.tts({ text: body.text })
        if (!authenticated(req)) { reply(401, { error: 'unauthorized' }); return }
        reply(200, result); return
      }
      reply(200, store.put(body, session.id))
    }
    catch { reply(400, { error: '请求失败，请检查附件或重试' }) }
  })
}
module.exports = { handleUpload }
