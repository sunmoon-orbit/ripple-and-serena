const crypto = require('node:crypto')
const digest = value => crypto.createHash('sha256').update(String(value || '')).digest('hex')
const OPERATIONS = new Set(['crossing/model/list', 'crossing/model/apply', 'crossing/thread/list', 'crossing/thread/start', 'crossing/thread/read', 'crossing/thread/resume', 'crossing/usage/read', 'crossing/turn/start', 'crossing/turn/steer', 'crossing/turn/interrupt', 'crossing/approval/respond'])

// Capabilities live only as long as their authenticated WebSocket, at most 15 min.
// Only fingerprints are retained; every use checks the current server credential.
function createAgentSessions({ getToken, now = Date.now, ttl = 15 * 60000, onRevoke = () => {} }) {
  const records = new Map()
  const current = () => { try { const value = getToken(); return value ? digest(value) : null } catch { return null } }
  const revoke = id => {
    const record = records.get(id)
    if (!record) return
    records.delete(id)
    onRevoke(record)
  }
  const get = id => {
    const record = records.get(id)
    if (!record) return null
    if (record.ws.readyState !== 1 || now() >= record.expiresAt || record.fingerprint !== current()) { revoke(id); return null }
    return record
  }
  return {
    open(ws, token, enabled) {
      if (ws.crossingClientId) revoke(ws.crossingClientId)
      const fingerprint = current()
      if (enabled !== true || typeof token !== 'string' || !token || !fingerprint || !crypto.timingSafeEqual(Buffer.from(digest(token)), Buffer.from(fingerprint))) return null
      const id = crypto.randomUUID(), capability = crypto.randomBytes(32).toString('base64url')
      const record = { id, ws, fingerprint, capabilityHash: digest(capability), expiresAt: now() + ttl }
      records.set(id, record)
      return { id, capability, expiresAt: record.expiresAt }
    },
    get, revoke,
    fromRequest(req) {
      const header = req.headers.authorization || ''
      if (!header.startsWith('Bearer ')) return null
      const hash = digest(header.slice(7))
      for (const [id, entry] of records) if (entry.capabilityHash === hash) return get(id)
      return null
    },
    sweep() { for (const id of records.keys()) get(id) },
  }
}
module.exports = { createAgentSessions, OPERATIONS }
