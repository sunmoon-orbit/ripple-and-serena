// 把高频流式 chunk 合并成稳定的 UI 刷新节奏。默认 50ms（约 20fps）：
// 对阅读仍然足够顺滑，同时避免手机 WebView 每个碎片都跑一次 React + Markdown。
export function createStreamUpdateScheduler(onFlush, delay = 50, timers = {}) {
  const setTimer = timers.setTimer || setTimeout
  const clearTimer = timers.clearTimer || clearTimeout
  let timer = null

  return {
    schedule() {
      if (timer !== null) return
      timer = setTimer(() => {
        timer = null
        onFlush()
      }, delay)
    },
    cancel() {
      if (timer === null) return
      clearTimer(timer)
      timer = null
    },
  }
}
