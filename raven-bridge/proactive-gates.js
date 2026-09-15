// A durable server revision prevents work started before opt-out from resuming
// after a later opt-in. Cooldown state files never grant contact permission.
async function captureGate(get, kind) {
  const config = await get('/proactive/config')
  if (!Number.isSafeInteger(config?.revision) || config[kind === 'call' ? 'callsEnabled' : 'messagesEnabled'] !== true) return null
  return config.revision
}
async function gateStillOpen(get, kind, revision) {
  return revision !== null && await captureGate(get, kind) === revision
}
module.exports = { captureGate, gateStillOpen }
