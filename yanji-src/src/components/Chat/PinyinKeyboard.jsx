import { useEffect, useMemo, useState } from 'react'
import {
  forgetPinyinSelection,
  loadPinyinLearning,
  rankPinyinCandidates,
  recordPinyinSelection,
  savePinyinLearning,
} from '../../utils/pinyinLearning'
import { createT9Index, getT9PinyinKeys } from '../../utils/t9Pinyin'
import './PinyinKeyboard.css'

const LETTER_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const QUICK_PUNCTUATION = ['，', '。', '？', '！', '、', '…', '：', '；']
const SYMBOLS = ['，', '。', '？', '！', '～', '、', '：', '；', '“', '”', '‘', '’', '（', '）', '【', '】', '《', '》', '…', '—', '@', '#', '+', '-', '=', '/', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
const T9_KEYS = [
  ['1', '标点'], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
]
const LAYOUT_STORAGE_KEY = 'yanji_pinyin_layout_v1'

let enginePromise
function getEngine() {
  if (!enginePromise) {
    enginePromise = Promise.all([
      import('pinyin-ime'),
      import('pinyin-ime/dictionary/google_pinyin_dict'),
    ]).then(([api, dictionary]) => ({
      engine: api.createPinyinEngine(dictionary.dict),
      dictionary: dictionary.dict,
    }))
  }
  return enginePromise
}

let t9IndexPromise
function getT9Index(dictionary) {
  if (!t9IndexPromise) {
    t9IndexPromise = new Promise((resolve, reject) => {
      setTimeout(() => {
        try { resolve(createT9Index(dictionary)) }
        catch (error) { reject(error) }
      }, 0)
    })
  }
  return t9IndexPromise
}

export default function PinyinKeyboard({ onInsert, onDeleteBackward, onUseSystem, onClose }) {
  const [ime, setIme] = useState(null)
  const [t9Index, setT9Index] = useState(null)
  const [t9Loading, setT9Loading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [buffer, setBuffer] = useState('')
  const [chineseMode, setChineseMode] = useState(true)
  const [uppercase, setUppercase] = useState(false)
  const [symbolMode, setSymbolMode] = useState(false)
  const [candidateExpanded, setCandidateExpanded] = useState(false)
  const [learning, setLearning] = useState(() => loadPinyinLearning())
  const [layout, setLayout] = useState(() => {
    try { return localStorage.getItem(LAYOUT_STORAGE_KEY) === 't9' ? 't9' : 'qwerty' }
    catch { return 'qwerty' }
  })
  const engine = ime?.engine || null
  const activeLayout = chineseMode ? layout : 'qwerty'

  useEffect(() => {
    let alive = true
    getEngine()
      .then((value) => { if (alive) setIme(value) })
      .catch(() => { if (alive) setLoadFailed(true) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (layout !== 't9' || !ime?.dictionary || t9Index) return undefined
    let alive = true
    setT9Loading(true)
    getT9Index(ime.dictionary)
      .then((value) => { if (alive) setT9Index(value) })
      .catch(() => { if (alive) setLoadFailed(true) })
      .finally(() => { if (alive) setT9Loading(false) })
    return () => { alive = false }
  }, [ime, layout, t9Index])

  const t9PinyinKeys = useMemo(() => (
    activeLayout === 't9' ? getT9PinyinKeys(t9Index, buffer) : []
  ), [activeLayout, buffer, t9Index])

  const candidates = useMemo(() => {
    if (!buffer || !engine) return []
    if (activeLayout === 't9') {
      const merged = []
      const seen = new Set()
      for (const source of t9PinyinKeys) {
        const found = engine.getCandidates(source.pinyin)?.candidates || []
        const ranked = rankPinyinCandidates(found, source.pinyin, learning).slice(0, 8)
        for (const item of ranked) {
          if (!item?.word || seen.has(item.word)) continue
          seen.add(item.word)
          merged.push({
            ...item,
            matchedLength: buffer.length,
            sourcePinyin: source.pinyin,
          })
          if (merged.length >= 40) return merged
        }
      }
      return merged
    }
    const found = engine.getCandidates(buffer)?.candidates || []
    return rankPinyinCandidates(found, buffer, learning).slice(0, 40)
  }, [activeLayout, buffer, engine, learning, t9PinyinKeys])

  useEffect(() => {
    if (!buffer || !candidates.length) setCandidateExpanded(false)
  }, [buffer, candidates.length])

  function remember(word, consumedPinyin) {
    const next = recordPinyinSelection(learning, consumedPinyin, word)
    setLearning(next)
    savePinyinLearning(next)
  }

  function choose(item, suffix = '') {
    if (!item) return
    const consumed = item.matchedLength || buffer.length
    remember(item.word, item.sourcePinyin || buffer.slice(0, consumed))
    onInsert(item.word + suffix)
    setCandidateExpanded(false)
    setBuffer((value) => activeLayout === 't9' ? '' : value.slice(consumed))
  }

  function typeLetter(letter) {
    if (symbolMode) setSymbolMode(false)
    if (chineseMode) setBuffer((value) => (value + letter.toLowerCase()).slice(0, 64))
    else onInsert(uppercase ? letter.toUpperCase() : letter)
  }

  function typeDigit(digit) {
    if (symbolMode) setSymbolMode(false)
    setBuffer((value) => (value + digit).slice(0, 32))
  }

  function backspace() {
    if (buffer) {
      if (buffer.length === 1) setCandidateExpanded(false)
      setBuffer((value) => value.slice(0, -1))
    }
    else onDeleteBackward()
  }

  function commitWith(suffix) {
    if (buffer) {
      if (candidates[0]) choose(candidates[0], suffix)
      else { onInsert(buffer + suffix); setCandidateExpanded(false); setBuffer('') }
    } else onInsert(suffix)
  }

  function forget(item) {
    const next = forgetPinyinSelection(learning, item.sourcePinyin || buffer, item.word)
    if (next === learning) return
    setLearning(next)
    savePinyinLearning(next)
  }

  function toggleLayout() {
    const next = layout === 't9' ? 'qwerty' : 't9'
    setLayout(next)
    setBuffer('')
    setSymbolMode(false)
    setCandidateExpanded(false)
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, next) } catch { /* 使用本次会话设置 */ }
  }

  function renderCandidate(item, index, location) {
    return (
      <button
        key={`${location}-${item.word}-${index}`}
        className="pinyin-candidate"
        onClick={() => choose(item)}
        onContextMenu={(e) => { e.preventDefault(); forget(item) }}
        title="点按上屏，长按忘记本机词频"
      >
        {index < 9 && <span>{index + 1}</span>}{item.word}
      </button>
    )
  }

  const composition = buffer
    ? activeLayout === 't9' && t9PinyinKeys[0]
      ? `${buffer} · ${t9PinyinKeys[0].pinyin}`
      : buffer
    : loadFailed
      ? '词库没加载好'
      : !engine
        ? '词库加载中…'
        : activeLayout === 't9' && t9Loading
          ? '九键词库加载中…'
          : activeLayout === 't9' ? '九键拼音' : '拼音'

  return (
    <div className="pinyin-keyboard" aria-label="言叽拼音键盘" onPointerDown={(e) => e.preventDefault()}>
      <div className="pinyin-candidate-bar">
        <span className={'pinyin-composition' + (buffer ? ' active' : '')}>
          {composition}
        </span>
        <div className="pinyin-candidates" aria-live="polite">
          {candidates.map((item, index) => renderCandidate(item, index, 'strip'))}
        </div>
        {!!candidates.length && (
          <button
            className={'pinyin-mini-btn pinyin-expand-btn' + (candidateExpanded ? ' active' : '')}
            onClick={() => setCandidateExpanded((value) => !value)}
            title={candidateExpanded ? '收起候选字' : '展开候选字'}
            aria-label={candidateExpanded ? '收起候选字' : '展开候选字'}
            aria-expanded={candidateExpanded}
            aria-controls="pinyin-candidate-panel"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={candidateExpanded ? 'm6 9 6 6 6-6' : 'm6 15 6-6 6 6'} /></svg>
          </button>
        )}
        <button className="pinyin-mini-btn" onClick={onClose} title="收起言叽键盘">⌄</button>
      </div>

      {candidateExpanded && (
        <div id="pinyin-candidate-panel" className="pinyin-candidate-panel" aria-label="全部候选字">
          {candidates.map((item, index) => renderCandidate(item, index, 'panel'))}
        </div>
      )}

      {!symbolMode && (
        <div className="pinyin-punctuation-row" aria-label="常用标点">
          {QUICK_PUNCTUATION.map((symbol) => (
            <button key={symbol} onClick={() => commitWith(symbol)}>{symbol}</button>
          ))}
        </div>
      )}

      {symbolMode ? (
        <div className="pinyin-symbol-grid">
          {SYMBOLS.map((symbol) => (
            <button key={symbol} className="pinyin-key" onClick={() => commitWith(symbol)}>{symbol}</button>
          ))}
        </div>
      ) : activeLayout === 't9' ? (
        <div className="pinyin-t9-grid" aria-label="九宫格拼音键盘">
          {T9_KEYS.map(([digit, letters]) => (
            <button
              key={digit}
              className="pinyin-key pinyin-t9-key"
              onClick={() => digit === '1' ? setSymbolMode(true) : typeDigit(digit)}
            >
              <strong>{digit}</strong><span>{letters}</span>
            </button>
          ))}
          <button className="pinyin-key pinyin-t9-key pinyin-t9-action" onClick={() => setSymbolMode(true)}>符号</button>
          <button className="pinyin-key pinyin-t9-key pinyin-t9-action" onClick={() => commitWith(' ')}>0 <span>空格</span></button>
          <button className="pinyin-key pinyin-t9-key pinyin-t9-action" onClick={backspace} aria-label="退格">⌫</button>
        </div>
      ) : (
        <div className="pinyin-letter-rows">
          {LETTER_ROWS.map((row, rowIndex) => (
            <div key={row} className={`pinyin-key-row row-${rowIndex + 1}`}>
              {row.split('').map((letter) => (
                <button key={letter} className="pinyin-key" onClick={() => typeLetter(letter)}>
                  {!chineseMode && uppercase ? letter.toUpperCase() : letter}
                </button>
              ))}
              {rowIndex === 2 && (
                <button className="pinyin-key pinyin-key-wide" onClick={backspace} aria-label="退格">⌫</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="pinyin-key-row pinyin-function-row">
        <button className="pinyin-key pinyin-key-wide" onClick={() => { setChineseMode((value) => !value); setCandidateExpanded(false); setBuffer('') }}>
          {chineseMode ? '中/英' : '英/中'}
        </button>
        {chineseMode && <button className="pinyin-key pinyin-layout-key" onClick={toggleLayout}>{layout === 't9' ? '26键' : '九键'}</button>}
        <button className={'pinyin-key' + (symbolMode ? ' active' : '')} onClick={() => { setCandidateExpanded(false); setSymbolMode((value) => !value) }}>符</button>
        {!chineseMode && <button className={'pinyin-key' + (uppercase ? ' active' : '')} onClick={() => setUppercase((value) => !value)}>⇧</button>}
        <button className="pinyin-key pinyin-space-key" onClick={() => buffer ? choose(candidates[0] || { word: buffer, matchedLength: buffer.length }) : onInsert(' ')}>空格</button>
        <button className="pinyin-key" onClick={() => commitWith('\n')}>换行</button>
        <button className="pinyin-key pinyin-system-key" onClick={() => { setCandidateExpanded(false); setBuffer(''); onUseSystem() }}>系统</button>
      </div>
    </div>
  )
}
