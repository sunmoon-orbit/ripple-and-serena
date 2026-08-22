const DIGIT_BY_LETTER = Object.freeze({
  a: '2', b: '2', c: '2',
  d: '3', e: '3', f: '3',
  g: '4', h: '4', i: '4',
  j: '5', k: '5', l: '5',
  m: '6', n: '6', o: '6',
  p: '7', q: '7', r: '7', s: '7',
  t: '8', u: '8', v: '8',
  w: '9', x: '9', y: '9', z: '9',
})

const MAX_PREFIX_SUGGESTIONS = 36
const MAX_EXACT_SUGGESTIONS = 18

export function toT9Digits(value) {
  return String(value || '')
    .toLowerCase()
    .split('')
    .map((letter) => DIGIT_BY_LETTER[letter] || '')
    .join('')
}

export function createT9Index(dictionary) {
  const root = createNode()

  for (const [rawPinyin, words] of Object.entries(dictionary || {})) {
    const pinyin = String(rawPinyin || '').toLowerCase().replace(/[^a-z]/g, '')
    const digits = toT9Digits(pinyin)
    if (!pinyin || !digits) continue

    const item = { pinyin, digits, score: highestFrequency(words) }
    let node = root
    for (const digit of digits) {
      if (!node.children.has(digit)) node.children.set(digit, createNode())
      node = node.children.get(digit)
      keepHighest(node.prefix, item, MAX_PREFIX_SUGGESTIONS)
    }
    keepHighest(node.exact, item, MAX_EXACT_SUGGESTIONS)
  }

  return root
}

export function getT9PinyinKeys(index, rawDigits, limit = 16) {
  const digits = String(rawDigits || '').replace(/[^2-9]/g, '')
  if (!index || !digits) return []

  let node = index
  for (const digit of digits) {
    node = node.children.get(digit)
    if (!node) return []
  }

  const seen = new Set()
  return [...node.exact, ...node.prefix]
    .sort((a, b) => {
      const exactDifference = Number(b.digits === digits) - Number(a.digits === digits)
      return exactDifference || b.score - a.score || a.pinyin.localeCompare(b.pinyin)
    })
    .filter((item) => {
      if (seen.has(item.pinyin)) return false
      seen.add(item.pinyin)
      return true
    })
    .slice(0, Math.max(1, limit))
}

function createNode() {
  return { children: new Map(), exact: [], prefix: [] }
}

function highestFrequency(words) {
  let highest = 0
  for (const item of words || []) highest = Math.max(highest, Number(item?.f) || 0)
  return highest
}

function keepHighest(list, item, limit) {
  if (list.length < limit) {
    list.push(item)
    return
  }

  let lowestIndex = 0
  for (let index = 1; index < list.length; index += 1) {
    if (list[index].score < list[lowestIndex].score) lowestIndex = index
  }
  if (item.score > list[lowestIndex].score) list[lowestIndex] = item
}
