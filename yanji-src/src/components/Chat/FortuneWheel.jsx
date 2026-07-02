import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { showToast } from '../Toast'
import { getDimensions, spin, randomTagTexts, getCustomTags, addCustomTag, removeCustomTag } from '../../api/fortuneWheel'

// 幸运轮盘 —— 移植自 Ruota della Fortuna（选好轮子，拉下拉杆，概不退换）
export default function FortuneWheel({ onClose }) {
  const dims = getDimensions()
  const normalDims = dims.filter((d) => !d.gore)
  const goreDim = dims.find((d) => d.gore)

  const [active, setActive] = useState(() => normalDims.map((d) => d.id))
  const [goreOn, setGoreOn] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [rows, setRows] = useState([])       // [{dimension, dimensionZh, zh, en, settled}]
  const [customOpen, setCustomOpen] = useState(false)
  const [customDim, setCustomDim] = useState(normalDims[0]?.id || 'position')
  const [customText, setCustomText] = useState('')
  const [customList, setCustomList] = useState(() => getCustomTags(normalDims[0]?.id || 'position'))
  const timersRef = useRef([])

  useEffect(() => () => timersRef.current.forEach(clearTimeout), [])
  useEffect(() => { setCustomList(getCustomTags(customDim)) }, [customDim])

  function toggleDim(id) {
    if (spinning) return
    setActive((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))
  }

  function pullLever() {
    if (spinning) return
    const activeNow = goreOn && goreDim ? [...active, goreDim.id] : active
    if (!activeNow.length) return showToast('至少选一个轮子', 'error')
    const results = spin({ active: activeNow, includeGore: goreOn })
    if (!results.length) return showToast('轮盘空转了一圈', 'error')

    setSpinning(true)
    // 起转：全部行进入翻动态
    setRows(results.map((r) => ({ ...r, settled: false, flicker: r.zh })))

    // 翻动帧：每 70ms 换一批随机字
    const iv = setInterval(() => {
      setRows((prev) => prev.map((r) => (r.settled ? r : { ...r, flicker: randomTagTexts(r.dimension, 1)[0] || r.zh })))
    }, 70)
    timersRef.current.push(iv)

    // 逐个落定：600ms 起步，每个错开 350ms
    results.forEach((r, i) => {
      const t = setTimeout(() => {
        setRows((prev) => prev.map((row) => (row.dimension === r.dimension ? { ...row, settled: true } : row)))
        if (i === results.length - 1) { clearInterval(iv); setSpinning(false) }
      }, 600 + i * 350)
      timersRef.current.push(t)
    })
  }

  function copyResult() {
    const text = rows.filter((r) => r.settled).map((r) => `【${r.dimensionZh || 'GORE'}】${r.zh}`).join('\n')
    if (!text) return
    navigator.clipboard?.writeText(text).then(() => showToast('已复制', 'success')).catch(() => showToast('复制失败', 'error'))
  }

  function submitCustom() {
    if (!customText.trim()) return
    if (addCustomTag(customDim, customText)) {
      setCustomList(getCustomTags(customDim))
      setCustomText('')
      showToast('已加入轮盘', 'success')
    } else showToast('已有这个标签', 'error')
  }

  const body = (
    <div className="roost-overlay" onClick={onClose}>
      <div className="roost-modal fw-modal" onClick={(e) => e.stopPropagation()}>
        <div className="roost-modal-header">
          <span>🎰 幸运轮盘</span>
          <button className="roost-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="roost-modal-body">
          <div className="fw-motto">选好轮子，拉下拉杆，概不退换。</div>

          {/* 轮子选择 */}
          <div className="fw-chips">
            {normalDims.map((d) => (
              <button key={d.id} className={'fw-chip' + (active.includes(d.id) ? ' on' : '')} onClick={() => toggleDim(d.id)}>
                {d.zh}
              </button>
            ))}
            {goreDim && (
              <button
                className={'fw-chip fw-chip-gore' + (goreOn ? ' on' : '')}
                onClick={() => { if (!spinning) setGoreOn((v) => !v) }}
                title="仅限虚构场景，默认锁定"
              >
                {goreOn ? '⚠ GORE' : '🔒 GORE'}
              </button>
            )}
          </div>

          {/* 结果区 */}
          {rows.length > 0 && (
            <div className="fw-results">
              {rows.map((r) => (
                <div key={r.dimension} className={'fw-row' + (r.settled ? ' settled' : '')}>
                  <span className="fw-row-dim">{r.dimensionZh || 'GORE'}</span>
                  <span className="fw-row-tag">{r.settled ? r.zh : r.flicker}</span>
                  {r.settled && r.en && <span className="fw-row-en">{r.en}</span>}
                </div>
              ))}
            </div>
          )}

          <button className={'btn-primary fw-lever' + (spinning ? ' spinning' : '')} onClick={pullLever} disabled={spinning}>
            {spinning ? '转动中…' : rows.length ? '再摇一次' : '拉下拉杆'}
          </button>
          {rows.length > 0 && !spinning && (
            <button className="roost-btn fw-copy" onClick={copyResult}>复制结果</button>
          )}

          {/* 自定义标签 */}
          <div className="fw-custom">
            <button className="fw-custom-toggle" onClick={() => setCustomOpen((v) => !v)}>
              {customOpen ? '▾' : '▸'} 自定义标签
            </button>
            {customOpen && (
              <div className="fw-custom-body">
                <div className="fw-custom-form">
                  <select className="filter-select" value={customDim} onChange={(e) => setCustomDim(e.target.value)}>
                    {normalDims.map((d) => <option key={d.id} value={d.id}>{d.zh}</option>)}
                  </select>
                  <input
                    className="fw-custom-input"
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitCustom()}
                    placeholder="加一个你想要的标签…"
                  />
                  <button className="roost-btn" onClick={submitCustom}>＋</button>
                </div>
                {customList.length > 0 && (
                  <div className="fw-custom-list">
                    {customList.map((t) => (
                      <span key={t.zh} className="fw-custom-tag">
                        {t.zh}
                        <button onClick={() => { removeCustomTag(customDim, t.zh); setCustomList(getCustomTags(customDim)) }}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
