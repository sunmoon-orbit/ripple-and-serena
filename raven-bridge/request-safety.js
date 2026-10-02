const path = require('path')
const fs = require('fs')

function regularFile(file) {
  try { return !fs.lstatSync(file).isSymbolicLink() && fs.statSync(file).isFile() }
  catch { return false }
}

function streamFile(file, res, options) {
  const stream = fs.createReadStream(file, options)
  stream.on('error', () => res.destroy())
  res.once('close', () => stream.destroy())
  stream.pipe(res)
}

function validPathname(pathname) {
  try { return !/[\x00-\x1f\x7f]/.test(decodeURIComponent(pathname)) }
  catch { return false }
}

function validSocketSession(ws, validate) {
  if (ws.authed && validate(ws.authToken)) return true
  ws.authed = false
  ws.send(JSON.stringify({ type: 'auth_failed' }))
  ws.close(1008, 'token expired or revoked')
  return false
}

// Attachment URLs are rendered with the browser token appended. Never accept
// a caller-provided origin, query, or traversal as an attachment destination.
function normalizeAttachments(attachments) {
  if (attachments == null) return []
  if (!Array.isArray(attachments) || attachments.length > 12) throw Object.assign(new Error('invalid_attachments'), { status: 400 })
  return attachments.map(item => {
    let id = String(item?.id || '')
    if (!id && typeof item?.url === 'string' && item.url.startsWith('/raven/uploads/')) {
      try { id = decodeURIComponent(item.url.slice('/raven/uploads/'.length)) } catch {}
    }
    if (!id || id.length > 240 || id === '.' || id === '..' || path.basename(id) !== id || /[\\\x00-\x1f\x7f?#]/.test(id)) {
      throw Object.assign(new Error('invalid_attachment_id'), { status: 400 })
    }
    return { id, name: String(item.name || id).slice(0, 240), mime: String(item.mime || '').slice(0, 120),
      size: Number.isFinite(item.size) && item.size >= 0 ? item.size : 0,
      url: '/raven/uploads/' + encodeURIComponent(id) }
  })
}

module.exports = { validPathname, validSocketSession, normalizeAttachments, regularFile, streamFile }
