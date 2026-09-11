const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'

export function parseUtcTimestamp(value) {
  if (!value) return null
  const text = String(value).trim()
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
    ? text
    : `${text.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  return Number.isFinite(date.getTime()) ? date : null
}

export function shanghaiDayKey(value) {
  const date = value instanceof Date ? value : parseUtcTimestamp(value)
  if (!date || !Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function formatShanghaiHm(value) {
  const date = parseUtcTimestamp(value)
  if (!date) return null
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: SHANGHAI_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

export function hasRealSleepInterval(row) {
  const start = parseUtcTimestamp(row?.sleep_start_at)
  const end = parseUtcTimestamp(row?.sleep_end_at)
  return Boolean(start && end && end.getTime() > start.getTime())
}

function emptyDay() {
  return {
    steps: 0,
    calories: 0,
    sleep_ms: 0,
    sleep_start_at: null,
    sleep_end_at: null,
    bpmAvg: null,
    bpmMax: 0,
  }
}

export function aggregateVitalsByShanghaiDay(rows) {
  const days = {}
  for (const row of rows) {
    const snapshotKey = shanghaiDayKey(row.created_at)
    if (!snapshotKey) continue
    const snapshotDay = days[snapshotKey] || emptyDay()
    snapshotDay.steps = Math.max(snapshotDay.steps, row.steps || 0)
    snapshotDay.calories = Math.max(snapshotDay.calories, row.calories || 0)
    if (row.bpm_avg) snapshotDay.bpmAvg = row.bpm_avg
    snapshotDay.bpmMax = Math.max(snapshotDay.bpmMax, row.bpm_max || 0)
    days[snapshotKey] = snapshotDay

    const realInterval = hasRealSleepInterval(row)
    const sleepKey = realInterval ? shanghaiDayKey(row.sleep_end_at) : snapshotKey
    const sleepDay = days[sleepKey] || emptyDay()
    const sleepMs = row.sleep_ms || 0
    if (sleepMs >= sleepDay.sleep_ms) sleepDay.sleep_ms = sleepMs
    if (realInterval) {
      sleepDay.sleep_start_at = row.sleep_start_at
      sleepDay.sleep_end_at = row.sleep_end_at
    }
    days[sleepKey] = sleepDay
  }
  return days
}
