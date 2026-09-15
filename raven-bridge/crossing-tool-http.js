// Existing human-operated tools only. No arbitrary URL, auth, config or model proxy.
function validateToolRequest(body) {
  const method = body.method || 'GET'
  const path = body.path
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || typeof path !== 'string' || path.length > 1024 ||
      /[\\\x00-\x20#]/.test(path) || /%2e|%2f|%5c|\.\./i.test(path) ||
      !/^\/(checklist|habits|vitals|board|music|games|period|cards|idle)(\/|\?|$)/.test(path)) throw new Error('invalid request')
  const url = new URL(path, 'http://fixture.invalid')
  if (/^\/(vitals|cards|idle)(\/|\?|$)/.test(path) && method !== 'GET') throw new Error('invalid request')
  for (const key of url.searchParams.keys()) if (/token|auth|cookie|key|secret/i.test(key)) throw new Error('invalid request')
  if (url.origin !== 'http://fixture.invalid') throw new Error('invalid request')
  return { method, path, body: body.body }
}
module.exports = { validateToolRequest }
