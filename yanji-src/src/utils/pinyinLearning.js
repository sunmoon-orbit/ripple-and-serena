const STORAGE_KEY = 'yanji_pinyin_learning_v1'
const MAX_PINYIN_KEYS = 800
const MAX_WORDS_PER_KEY = 8

export function normalizePinyin(value) {
  return String(value || '').toLowerCase().replace(/[^a-z']/g, '').slice(0, 64)
}

export function loadPinyinLearning(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function savePinyinLearning(learning, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(pruneLearning(learning)))
    return true
  } catch {
    return false
  }
}

export function recordPinyinSelection(learning, rawPinyin, rawWord, now = Date.now()) {
  const pinyin = normalizePinyin(rawPinyin)
  const word = String(rawWord || '').trim().slice(0, 24)
  if (!pinyin || !word) return learning || {}

  const next = { ...(learning || {}) }
  const entries = Array.isArray(next[pinyin]) ? [...next[pinyin]] : []
  const found = entries.find((entry) => entry?.word === word)
  if (found) {
    found.count = Math.min(9999, Math.max(0, Number(found.count) || 0) + 1)
    found.lastUsed = now
  } else {
    entries.push({ word, count: 1, lastUsed: now })
  }
  next[pinyin] = entries
    .sort((a, b) => learningScore(b, now) - learningScore(a, now))
    .slice(0, MAX_WORDS_PER_KEY)
  return pruneLearning(next)
}

export function forgetPinyinSelection(learning, rawPinyin, rawWord) {
  const pinyin = normalizePinyin(rawPinyin)
  const word = String(rawWord || '').trim()
  if (!pinyin || !Array.isArray(learning?.[pinyin])) return learning || {}
  const next = { ...learning, [pinyin]: learning[pinyin].filter((entry) => entry?.word !== word) }
  if (!next[pinyin].length) delete next[pinyin]
  return next
}

export function rankPinyinCandidates(candidates, rawPinyin, learning, now = Date.now()) {
  const pinyin = normalizePinyin(rawPinyin)
  const learned = Array.isArray(learning?.[pinyin]) ? learning[pinyin] : []
  const learnedByWord = new Map(learned.map((entry) => [entry.word, entry]))
  const seen = new Set()
  const merged = []

  for (const entry of learned) {
    if (!entry?.word || seen.has(entry.word)) continue
    seen.add(entry.word)
    merged.push({ word: entry.word, matchedLength: pinyin.length, _learned: learningScore(entry, now) })
  }
  for (const item of candidates || []) {
    if (!item?.word || seen.has(item.word)) continue
    seen.add(item.word)
    const entry = learnedByWord.get(item.word)
    merged.push({ ...item, _learned: entry ? learningScore(entry, now) : 0 })
  }

  return merged
    .sort((a, b) => (b._learned || 0) - (a._learned || 0))
    .map(({ _learned, ...item }) => item)
}

function learningScore(entry, now) {
  const count = Math.max(0, Number(entry?.count) || 0)
  const ageDays = Math.max(0, now - (Number(entry?.lastUsed) || 0)) / 86400000
  return count * 100 + Math.max(0, 30 - ageDays)
}

function pruneLearning(learning) {
  return Object.fromEntries(
    Object.entries(learning || {})
      .filter(([pinyin, entries]) => normalizePinyin(pinyin) === pinyin && Array.isArray(entries) && entries.length)
      .sort(([, a], [, b]) => newest(b) - newest(a))
      .slice(0, MAX_PINYIN_KEYS)
      .map(([pinyin, entries]) => [pinyin, entries.slice(0, MAX_WORDS_PER_KEY)]),
  )
}

function newest(entries) {
  return Math.max(0, ...entries.map((entry) => Number(entry?.lastUsed) || 0))
}

export { STORAGE_KEY as PINYIN_LEARNING_STORAGE_KEY }
