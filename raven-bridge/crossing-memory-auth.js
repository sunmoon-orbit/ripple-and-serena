const http = require('node:http')
// Verify against the existing protected API, not its public /health endpoint.
// Never read or echo the response body; credentials stay in an HTTP header.
function verifyMemoryToken(token, transport = http) {
  return new Promise(resolve => {
    try {
      const request = transport.get({ hostname: '127.0.0.1', port: 3210, path: '/emotion/contact', headers: { Authorization: `Bearer ${token}` } }, response => {
        response.resume()
        resolve(response.statusCode === 200)
      })
      request.setTimeout(5000, () => { request.destroy(); resolve(false) })
      request.on('error', () => resolve(false))
    } catch { resolve(false) }
  })
}
module.exports = { verifyMemoryToken }
