// 终端里的 CC 是不是卡在登录／授权报错上（0930 起有这个判断，1006 重写）。
//
// 原来的写法：屏幕最后 20 行里有报错就当离线、不再注入。它假设报错只会来自订阅过期，要重启 CC 才会消失。
// 1006 早上碰到一次一闪而过的 403：报错留在屏幕上 → 判离线 → 不注入 → 屏幕不变 → 永远判离线。
// 她在归巢看到「CC 离线」，开了电脑从终端敲字才把它顶走。
//
// 现在看的是「谁在最后」：报错之后只要出现过正常的回复、或者有新的输入交上去了，就不算卡住。
// 再加一个保质期：卡住满一段时间，放下一条真消息过去当探针，探不通再退避。

const ERROR_LINE = /^\s*(?:⎿|●)?\s*(?:Please run \/login\b|API Error: 40[13]\b|.*Credit balance is too low)/
const RULE_LINE = /^[─━]{8,}/

function authStateFromCapture(capture) {
  const lines = String(capture || '').split('\n')
  let lastError = -1, lastReply = -1, lastInput = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (ERROR_LINE.test(line)) { lastError = i; continue }
    if (/^● /.test(line)) { lastReply = i; continue }
    if (/^❯ \S/.test(line)) {
      // 屏幕底部的输入框也以 ❯ 开头，它的上一行紧贴着一条横线；那不是交上去的话
      if (!(i > 0 && RULE_LINE.test(lines[i - 1]))) lastInput = i
    }
  }
  return { broken: lastError >= 0 && lastError > lastReply && lastError > lastInput, lastError, lastReply, lastInput }
}

// 探针的间隔：3、6、12 分钟，之后一直 12 分钟
const PROBE_DELAYS_MS = [3, 6, 12].map((m) => m * 60000)
function probeDelay(step) { return PROBE_DELAYS_MS[Math.min(Math.max(step, 0), PROBE_DELAYS_MS.length - 1)] }

// 记着「从什么时候开始卡住、下一次什么时候可以探」。纯状态机，时间由调用方传进来，方便测
function createAuthGate() {
  let since = null, nextProbeAt = 0, step = 0
  return {
    // 每次看完屏幕喂进来；返回这一刻要不要拦住注入
    observe(broken, now) {
      if (!broken) { since = null; nextProbeAt = 0; step = 0; return { blocked: false, probe: false } }
      if (since === null) { since = now; nextProbeAt = now + probeDelay(0) }
      return { blocked: now < nextProbeAt, probe: now >= nextProbeAt }
    },
    // 真的放了一条探针过去之后调用：把下一次探的时间往后推
    probed(now) { step += 1; nextProbeAt = now + probeDelay(step) },
    minutesUntilProbe(now) { return since !== null ? Math.max(0, Math.ceil((nextProbeAt - now) / 60000)) : 0 },
    stuckSince() { return since === null ? 0 : since || 1 },
  }
}

module.exports = { authStateFromCapture, createAuthGate, probeDelay, ERROR_LINE }
