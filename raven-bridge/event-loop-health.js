const { performance } = require('perf_hooks')

function createEventLoopHealth(options = {}) {
  const intervalMs = options.intervalMs || 1000
  const warnMs = options.warnMs || 500
  const warnSamples = options.warnSamples || 1
  const logCooldownMs = options.logCooldownMs || 60000
  const now = options.now || (() => performance.now())
  const logger = options.logger || console.warn
  let expected = now() + intervalMs
  let lagMs = 0
  let maxLagMs = 0
  let consecutiveHigh = 0
  let lastWarningAt = -Infinity

  function sample(at = now()) {
    lagMs = Math.max(0, at - expected)
    maxLagMs = Math.max(maxLagMs, lagMs)
    expected = at + intervalMs
    consecutiveHigh = lagMs >= warnMs ? consecutiveHigh + 1 : 0
    if (consecutiveHigh >= warnSamples && at - lastWarningAt >= logCooldownMs) {
      lastWarningAt = at
      logger(`[health] event loop lag sustained at ${Math.round(lagMs)}ms`)
    }
    return lagMs
  }

  const timer = (options.setInterval || setInterval)(sample, intervalMs)
  timer?.unref?.()
  return {
    snapshot: () => ({ eventLoopLagMs: Math.round(lagMs), eventLoopMaxLagMs: Math.round(maxLagMs) }),
    sample,
    stop: () => (options.clearInterval || clearInterval)(timer),
  }
}

module.exports = { createEventLoopHealth }
