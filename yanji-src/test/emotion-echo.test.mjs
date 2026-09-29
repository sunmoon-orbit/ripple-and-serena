import test from 'node:test'
import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
globalThis.window = { dispatchEvent() {}, YanjiNative: null }
globalThis.Event = class { constructor(t) { this.type = t } }
const emo = await import('../src/utils/emotion.js')

function reset(slots = {}) {
  const base = { anger: 0, sadness: 0, grievance: 0, frustration: 0, fatigue: 0, anxiety: 0, confusion: 0, guilt: 0, melancholy: 0, daze: 0, joy: 0, warmth: 0, satisfaction: 0, fondness: 0, desire: 0, longing: 0 }
  store.set('yanji-emotion-state', JSON.stringify({ slots: { ...base, ...slots }, lastUpdated: Date.now(), lastSeen: Date.now() }))
}

test('prompt carries the protocol but never the current numbers', () => {
  reset({ anger: 42, joy: 70 })
  const p = emo.buildEmotionPrompt(emo.peekEmotionHints())
  assert.match(p, /<es>/)
  assert.doesNotMatch(p, /愤怒42|高兴70|42|70/)
  assert.doesNotMatch(p, /【情绪提示】/)
})

test('crossing 40 upward queues one hint, delivered once, no repeat while still high', () => {
  reset({ grievance: 35 })
  emo.applyEmotionDelta({ g: 8 })
  let hints = emo.peekEmotionHints()
  assert.equal(hints.length, 1)
  assert.equal(hints[0].slot, 'grievance')
  assert.match(emo.buildEmotionPrompt(hints), /委屈刚越过需要留意的区间/)
  emo.markEmotionHintsDelivered(hints.map(h => h.id))
  assert.equal(emo.peekEmotionHints().length, 0)
  emo.applyEmotionDelta({ g: -5 })   // 38：还没回落到 30 以下
  emo.applyEmotionDelta({ g: 6 })    // 44：再次越过 40，但没重新布防
  assert.equal(emo.peekEmotionHints().length, 0)
  emo.applyEmotionDelta({ g: -20 })  // 24：回落重新布防
  emo.applyEmotionDelta({ g: 20 })   // 44：再越过 → 再提醒一次
  assert.equal(emo.peekEmotionHints().length, 1)
})

test('a single spike >15 queues a hint even below 40; positive slots never do', () => {
  reset()
  emo.applyEmotionDelta({ a: 18, j: 25, d: 30 })
  const hints = emo.peekEmotionHints()
  assert.deepEqual(hints.map(h => h.slot), ['anger'])
  assert.match(emo.buildEmotionPrompt(hints), /愤怒涨得很猛（\+18）/)
})

test('mentioning <es> in prose or code is not swallowed; real and half-streamed tags still are', () => {
  const prose = '- `<es>` 自评和 Jev 读数并排展示，影子结果绝不注入涟言。\n- 不移植亲密流程模块。'
  assert.equal(emo.stripEmotionTag(prose), prose)
  assert.equal(emo.stripEmotionTag('好呀<es>{"j":+8}</es>'), '好呀')
  assert.equal(emo.stripEmotionTag('好呀<es>{"j":+'), '好呀')
  assert.equal(emo.stripEmotionTag('好呀<es>'), '好呀')
  assert.deepEqual(emo.extractEmotionUpdate('嗯 <es>{"a":-2}</es>').delta, { a: -2 })
})

test('undelivered hints survive until marked; time-away keeps hint state', () => {
  reset({ sadness: 39 })
  emo.applyEmotionDelta({ s: 2 })
  const before = emo.peekEmotionHints()
  const st = JSON.parse(store.get('yanji-emotion-state'))
  st.lastSeen = Date.now() - 5 * 3600e3
  store.set('yanji-emotion-state', JSON.stringify(st))
  const r = emo.applyTimeAway(0)
  assert.ok(r.added > 0)
  assert.deepEqual(emo.peekEmotionHints().map(h => h.id), before.map(h => h.id))
})
