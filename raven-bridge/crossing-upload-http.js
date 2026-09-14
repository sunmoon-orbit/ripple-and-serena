const MAX_BODY = 6 * 1024 * 1024
function handleUpload(req, res, store, authenticated = () => false) {
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
  req.on('end', () => {
    if (rejected) return
    try { reply(200, store.put(JSON.parse(Buffer.concat(chunks).toString('utf8')))) }
    catch (e) { reply(400, { error: e.code ? '临时附件保存失败' : e instanceof SyntaxError ? '附件数据无效' : e.message }) }
  })
}
module.exports = { handleUpload }
