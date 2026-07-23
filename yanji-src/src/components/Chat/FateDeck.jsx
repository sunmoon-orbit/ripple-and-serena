import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { showToast } from '../Toast'
import { drawFate, fateToMessage, loadFateData } from '../../api/fateDeck'

// 命运牌阵 —— 抽一张时空坐标+三枚骰子，抽完可以「请涟言去这里」（乌有乡联动）
export default function FateDeck({ onClose, onSend }) {
  const [fate, setFate] = useState(null)
  const [drawing, setDrawing] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const timersRef = useRef([])

  useEffect(() => {
    loadFateData().catch(() => {}) // 预热数据，抽的时候不用等
    return () => timersRef.current.forEach(clearTimeout)
  }, [])

  async function draw() {
    if (drawing) return
    setDrawing(true)
    setFlipped(false)
    try {
      const f = await drawFate()
      // 先给一拍背面状态再翻，抽第二次也有翻牌感
      timersRef.current.push(setTimeout(() => {
        setFate(f)
        timersRef.current.push(setTimeout(() => { setFlipped(true); setDrawing(false) }, 60))
      }, fate ? 320 : 60))
    } catch (e) {
      showToast('牌阵没抽出来：' + e.message, 'error')
      setDrawing(false)
    }
  }

  function sendToChat() {
    if (!fate) return
    onSend?.(fateToMessage(fate), [])
    onClose?.()
  }

  function copyResult() {
    if (!fate) return
    navigator.clipboard?.writeText(fateToMessage(fate))
      .then(() => showToast('已复制', 'success'))
      .catch(() => showToast('复制失败', 'error'))
  }

  const c = fate?.coord

  const body = (
    <div className="roost-overlay" onClick={onClose}>
      <div className="roost-modal fate-modal" onClick={(e) => e.stopPropagation()}>
        <div className="roost-modal-header">
          <span>🃏 命运牌阵</span>
          <button className="roost-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="roost-modal-body">
          <div className="fw-motto">抽一个时空，掷三枚骰子，去那里过一天。</div>

          {/* 主牌：时空坐标 */}
          <div className={'fate-card' + (flipped ? ' flipped' : '')}>
            {!fate ? (
              <div className="fate-card-back">
                <span className="fate-back-mark">✦</span>
                <span className="fate-back-text">Tirage du Destin</span>
              </div>
            ) : (
              <div className="fate-card-front">
                <div className="fate-coord-era">{[c.era, c.p].filter(Boolean).join(' · ')}</div>
                <div className="fate-coord-name">{c.n}</div>
                {c.en && <div className="fate-coord-en">{c.en}</div>}
                {c.s && <div className="fate-coord-sense">{c.s}</div>}
                {c.a && <div className="fate-coord-atmo">{c.a}</div>}
              </div>
            )}
          </div>

          {/* 三枚骰子 */}
          {fate && flipped && (
            <div className="fate-dice">
              {[['母题', fate.motif], ['身份', fate.identity], ['变数', fate.variable]].map(([label, d], i) => (
                <div key={label} className="fate-die" style={{ animationDelay: `${0.15 + i * 0.12}s` }}>
                  <span className="fate-die-label">{label}</span>
                  <span className="fate-die-name">{d.n}</span>
                  <span className="fate-die-desc">{d.d}</span>
                </div>
              ))}
            </div>
          )}

          <button className={'btn-primary fw-lever'} onClick={draw} disabled={drawing}>
            {drawing ? '洗牌中…' : fate ? '再抽一次' : '抽牌'}
          </button>

          {fate && flipped && (
            <div className="fate-actions">
              <button className="roost-btn fate-go" onClick={sendToChat}>🌍 请涟言去这里</button>
              <button className="roost-btn" onClick={copyResult}>复制</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
