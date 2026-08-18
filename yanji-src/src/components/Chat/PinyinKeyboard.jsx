import { useEffect, useMemo, useState } from 'react'
import {
  forgetPinyinSelection,
  loadPinyinLearning,
  rankPinyinCandidates,
  recordPinyinSelection,
  savePinyinLearning,
} from '../../utils/pinyinLearning'

const LETTER_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const SYMBOLS = ['，', '。', '？', '！', '～', '、', '：', '；', '“', '”', '（', '）', '…', '—', '@', '#', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

let enginePromise
function getEngine() {
  if (!enginePromise) {
    enginePromise = Promise.all([
      import('pinyin-ime'),
      import('pinyin-ime/dictionary/google_pinyin_dict'),
    ]).then(([api, dictionary]) => api.createPinyinEngine(dictionary.dict))
  }
  return enginePromise
}

export default function PinyinKeyboard({ onInsert, onDeleteBackward, onUseSystem, onClose }) {
  const [engine, setEngine] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [buffer, setBuffer] = useState('')
  const [chineseMode, setChineseMode] = useState(true)
  const [uppercase, setUppercase] = useState(false)
  const [symbolMode, setSymbolMode] = useState(false)
  const [learning, setLearning] = useState(() => loadPinyinLearning())

  useEffect(() => {
    let alive = true
    getEngine()
      .then((value) => { if (alive) setEngine(value) })
      .catch(() => { if (alive) setLoadFailed(true) })
    return () => { alive = false }
  }, [])

  const candidates = useMemo(() => {
    if (!buffer || !engine) return []
    const found = engine.getCandidates(buffer)?.candidates || []
    return rankPinyinCandidates(found, buffer, learning).slice(0, 40)
  }, [buffer, engine, learning])

  function remember(word, consumedPinyin) {
    const next = recordPinyinSelection(learning, consumedPinyin, word)
    setLearning(next)
    savePinyinLearning(next)
  }

  function choose(item, suffix = '') {
    if (!item) return
    const consumed = item.matchedLength || buffer.length
    remember(item.word, buffer.slice(0, consumed))
    onInsert(item.word + suffix)
    setBuffer((value) => value.slice(consumed))
  }

  function typeLetter(letter) {
    if (symbolMode) setSymbolMode(false)
    if (chineseMode) setBuffer((value) => (value + letter.toLowerCase()).slice(0, 64))
    else onInsert(uppercase ? letter.toUpperCase() : letter)
  }

  function backspace() {
    if (buffer) setBuffer((value) => value.slice(0, -1))
    else onDeleteBackward()
  }

  function commitWith(suffix) {
    if (buffer) {
      if (candidates[0]) choose(candidates[0], suffix)
      else { onInsert(buffer + suffix); setBuffer('') }
    } else onInsert(suffix)
  }

  function forget(item) {
    const next = forgetPinyinSelection(learning, buffer, item.word)
    if (next === learning) return
    setLearning(next)
    savePinyinLearning(next)
  }

  return (
    <div className="pinyin-keyboard" aria-label="言叽拼音键盘" onPointerDown={(e) => e.preventDefault()}>
      <div className="pinyin-candidate-bar">
        <span className={'pinyin-composition' + (buffer ? ' active' : '')}>
          {buffer || (loadFailed ? '词库没加载好' : engine ? '拼音' : '词库加载中…')}
        </span>
        <div className="pinyin-candidates" aria-live="polite">
          {candidates.map((item, index) => (
            <button
              key={`${item.word}-${index}`}
              className="pinyin-candidate"
              onClick={() => choose(item)}
              onContextMenu={(e) => { e.preventDefault(); forget(item) }}
              title="点按上屏，长按忘记本机词频"
            >
              {index < 9 && <span>{index + 1}</span>}{item.word}
            </button>
          ))}
        </div>
        <button className="pinyin-mini-btn" onClick={onClose} title="收起言叽键盘">⌄</button>
      </div>

      {symbolMode ? (
        <div className="pinyin-symbol-grid">
          {SYMBOLS.map((symbol) => (
            <button key={symbol} className="pinyin-key" onClick={() => commitWith(symbol)}>{symbol}</button>
          ))}
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
        <button className="pinyin-key pinyin-key-wide" onClick={() => { setChineseMode((value) => !value); setBuffer('') }}>
          {chineseMode ? '中/英' : '英/中'}
        </button>
        <button className={'pinyin-key' + (symbolMode ? ' active' : '')} onClick={() => setSymbolMode((value) => !value)}>符</button>
        {!chineseMode && <button className={'pinyin-key' + (uppercase ? ' active' : '')} onClick={() => setUppercase((value) => !value)}>⇧</button>}
        <button className="pinyin-key pinyin-space-key" onClick={() => buffer ? choose(candidates[0] || { word: buffer, matchedLength: buffer.length }) : onInsert(' ')}>空格</button>
        <button className="pinyin-key" onClick={() => commitWith('\n')}>换行</button>
        <button className="pinyin-key pinyin-system-key" onClick={() => { setBuffer(''); onUseSystem() }}>系统</button>
      </div>
    </div>
  )
}
