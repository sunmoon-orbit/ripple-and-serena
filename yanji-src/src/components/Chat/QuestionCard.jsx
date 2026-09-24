import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { normalizeQuestion } from '../../utils/questionCard'

export default function QuestionCard({ request, onAnswer }) {
  const data = useMemo(() => normalizeQuestion(request), [request])
  const [customOpen, setCustomOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { if (customOpen) inputRef.current?.focus() }, [customOpen])
  const submitCustom = () => {
    const answer = custom.trim()
    if (answer) onAnswer(answer)
  }

  return createPortal(
    <div className="question-card-mask" role="presentation">
      <section className="question-card" role="dialog" aria-modal="true" aria-labelledby="question-card-title">
        <div className="question-card-grip" aria-hidden="true" />
        <div className="question-card-head">
          <div>
            <span className="question-card-kicker">涟言想问你</span>
            <h2 id="question-card-title">{data.question}</h2>
          </div>
          <button className="question-card-close" type="button" onClick={() => onAnswer(null)} aria-label="跳过">×</button>
        </div>
        <div className="question-options">
          {data.options.map((option) => (
            <button className="question-option" type="button" key={option.label} onClick={() => onAnswer(option.label)}>
              <span className="question-option-copy">
                <strong>{option.label}</strong>
                {option.recommended && <em>推荐</em>}
                {option.description && <small>{option.description}</small>}
              </span>
              <span className="question-option-arrow" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
        {data.allowCustom && (
          customOpen ? (
            <div className="question-custom-row">
              <input ref={inputRef} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="写下你的答案…" maxLength={300}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitCustom() } }} />
              <button type="button" disabled={!custom.trim()} onClick={submitCustom}>发送</button>
            </div>
          ) : <button className="question-custom-open" type="button" onClick={() => setCustomOpen(true)}>我想自己说…</button>
        )}
        <button className="question-skip" type="button" onClick={() => onAnswer(null)}>跳过这个问题</button>
      </section>
    </div>,
    document.body,
  )
}
