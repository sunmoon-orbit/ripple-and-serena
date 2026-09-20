function pingActiveSockets(...collections) {
  const sockets = new Set()
  for (const collection of collections) {
    const values = collection instanceof Map ? collection.values() : collection
    for (const socket of values || []) sockets.add(socket)
  }
  let pinged = 0
  for (const socket of sockets) {
    if (socket?.readyState !== 1) continue
    try { socket.ping(); pinged++ } catch {}
  }
  return pinged
}

module.exports = { pingActiveSockets }
