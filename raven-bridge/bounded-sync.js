const { spawnSync, execFileSync } = require('child_process')

const DEFAULT_TIMEOUT_MS = 1000
const DEFAULT_BACKOFF_MS = 30000
const blockedUntil = new Map()
let lastFailure = null

function timedOut(result) {
  return result?.error?.code === 'ETIMEDOUT' || result?.error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
}

function recordFailure(key, now, backoffMs, code) {
  blockedUntil.set(key, now + backoffMs)
  lastFailure = { command: key, at: now, reason: code || 'timeout' }
  console.warn(`[health] synchronous command ${key} failed (${code || 'timeout'}); backing off ${backoffMs}ms`)
}

function spawnBounded(key, command, args = [], options = {}) {
  const now = Date.now()
  const until = blockedUntil.get(key) || 0
  if (until > now) return { stdout: '', stderr: '', status: null, skipped: true, retryAt: until }
  const { backoffMs = DEFAULT_BACKOFF_MS, ...childOptions } = options
  const timeout = childOptions.timeout || DEFAULT_TIMEOUT_MS
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    killSignal: 'SIGKILL',
    ...childOptions,
    timeout,
  })
  if (timedOut(result)) recordFailure(key, now, backoffMs, result.error?.code)
  else blockedUntil.delete(key)
  return result
}

function execFileBounded(key, command, args = [], options = {}) {
  const now = Date.now()
  const until = blockedUntil.get(key) || 0
  if (until > now) return false
  const { backoffMs = DEFAULT_BACKOFF_MS, ...childOptions } = options
  try {
    execFileSync(command, args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      killSignal: 'SIGKILL',
      ...childOptions,
      timeout: childOptions.timeout || DEFAULT_TIMEOUT_MS,
    })
    blockedUntil.delete(key)
    return true
  } catch (error) {
    if (error?.code === 'ETIMEDOUT' || error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      recordFailure(key, now, backoffMs, error.code)
    }
    return false
  }
}

function diagnostics(now = Date.now()) {
  for (const [key, until] of blockedUntil) if (until <= now) blockedUntil.delete(key)
  return { backedOffCommands: [...blockedUntil.keys()].sort(), lastSyncCommandFailure: lastFailure }
}

function resetForTest() { blockedUntil.clear(); lastFailure = null }

module.exports = { spawnBounded, execFileBounded, diagnostics, resetForTest }
