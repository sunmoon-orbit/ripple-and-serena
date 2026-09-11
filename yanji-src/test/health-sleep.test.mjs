import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateVitalsByShanghaiDay,
  formatShanghaiHm,
  hasRealSleepInterval,
  shanghaiDayKey,
} from '../src/utils/healthSleep.js'

test('cross-midnight sleep belongs to its Shanghai wake-up day', () => {
  const row = {
    created_at: '2026-09-11 00:15:00',
    sleep_ms: 6 * 3600000,
    sleep_start_at: '2026-09-10T15:30:00.000Z',
    sleep_end_at: '2026-09-10T23:45:00.000Z',
  }
  const days = aggregateVitalsByShanghaiDay([row])
  assert.equal(shanghaiDayKey(row.sleep_end_at), '2026-09-11')
  assert.equal(days['2026-09-11'].sleep_ms, 6 * 3600000)
  assert.equal(days['2026-09-11'].sleep_start_at, row.sleep_start_at)
  assert.equal(formatShanghaiHm(row.sleep_start_at), '23:30')
  assert.equal(formatShanghaiHm(row.sleep_end_at), '07:45')
})

test('legacy snapshots keep duration without fabricating real sleep times', () => {
  const row = {
    created_at: '2026-09-11 00:15:00',
    sleep_ms: 7 * 3600000,
    sleep_start_at: null,
    sleep_end_at: null,
  }
  const days = aggregateVitalsByShanghaiDay([row])
  assert.equal(hasRealSleepInterval(row), false)
  assert.equal(days['2026-09-11'].sleep_ms, 7 * 3600000)
  assert.equal(days['2026-09-11'].sleep_start_at, null)
  assert.equal(days['2026-09-11'].sleep_end_at, null)
})
