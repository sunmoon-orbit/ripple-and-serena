import test from 'node:test'
import assert from 'node:assert/strict'

import { createStreamUpdateScheduler } from '../src/utils/streamUpdateScheduler.js'

function fakeTimers() {
  let nextId = 1
  const jobs = new Map()
  return {
    setTimer(fn) {
      const id = nextId++
      jobs.set(id, fn)
      return id
    },
    clearTimer(id) { jobs.delete(id) },
    runAll() {
      const pending = [...jobs.values()]
      jobs.clear()
      pending.forEach((fn) => fn())
    },
    size() { return jobs.size },
  }
}

test('同一刷新窗口内的多个 chunk 只触发一次 UI 更新', () => {
  const timers = fakeTimers()
  let flushes = 0
  const scheduler = createStreamUpdateScheduler(() => { flushes++ }, 50, timers)

  scheduler.schedule()
  scheduler.schedule()
  scheduler.schedule()

  assert.equal(timers.size(), 1)
  timers.runAll()
  assert.equal(flushes, 1)
})

test('一次刷新完成后可以继续安排下一帧', () => {
  const timers = fakeTimers()
  let flushes = 0
  const scheduler = createStreamUpdateScheduler(() => { flushes++ }, 50, timers)

  scheduler.schedule()
  timers.runAll()
  scheduler.schedule()
  timers.runAll()

  assert.equal(flushes, 2)
})

test('最终消息落地前取消待执行刷新，避免 streaming 状态复活', () => {
  const timers = fakeTimers()
  let flushes = 0
  const scheduler = createStreamUpdateScheduler(() => { flushes++ }, 50, timers)

  scheduler.schedule()
  scheduler.cancel()
  timers.runAll()

  assert.equal(flushes, 0)
})
