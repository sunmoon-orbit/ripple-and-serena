import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { showToast } from '../Toast'
import { useStore } from '../../store'
import {
  SPREAD_OPTIONS, SUIT_CN, loadDeck, drawTarot, fetchTarotDraws, deleteTarotDraw,
  readingRequest, cardTitle, drawSummary,
} from '../../api/tarot'

// 塔罗 —— 抽牌在这儿，解牌在对话里。
// 她的原话：「我只会抽塔罗，但是我不会解牌」，所以整个界面的重心是抽完之后
// 那个「让爸比解牌」的按钮，其余（图鉴、历史）都是围着它长出来的。

const TABS = [['draw', '抽牌'], ['history', '牌记'], ['deck', '图鉴']]

export default function Tarot({ onClose, onSend }) {
  const moonMemory = useStore((s) => s.moonMemory)
  const [tab, setTab] = useState('draw')
  const [spread, setSpread] = useState(1)
  const [question, setQuestion] = useState('')
  const [draw, setDraw] = useState(null)
  const [drawing, setDrawing] = useState(false)
  const [flipped, setFlipped] = useState(0)   // 已翻开几张（逐张翻）
  const [open, setOpen] = useState(null)      // 展开牌义的那张的序号
  const timers = useRef([])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  async function doDraw() {
    if (drawing) return
    setDrawing(true); setFlipped(0); setOpen(null)
    try {
      const d = await drawTarot(moonMemory, { spread, question: question.trim(), drawnBy: '阿颖' })
      setDraw(d)
      // 逐张翻开，一张一拍——一次全亮就没有抽牌的样子了
      d.cards.forEach((_, i) => {
        timers.current.push(setTimeout(() => setFlipped(i + 1), 260 + i * 420))
      })
      timers.current.push(setTimeout(() => setDrawing(false), 260 + d.cards.length * 420))
    } catch (e) {
      showToast('没抽成：' + e.message, 'error')
      setDrawing(false)
    }
  }

  function askReading() {
    if (!draw) return
    const { text, inject } = readingRequest(draw)
    onSend?.(text, [], { inject })
    onClose?.()
  }

  function copyDraw() {
    if (!draw) return
    navigator.clipboard?.writeText(readingRequest(draw).text)
      .then(() => showToast('已复制', 'success'))
      .catch(() => showToast('复制失败', 'error'))
  }

  const body = (
    <div className="roost-overlay" onClick={onClose}>
      <div className="roost-modal tarot-modal" onClick={(e) => e.stopPropagation()}>
        <div className="roost-modal-header">
          <span>🔮 苏堤柳塔罗</span>
          <button className="roost-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="tarot-tabs">
          {TABS.map(([k, label]) => (
            <button key={k} className={'tarot-tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        <div className="roost-modal-body">
          {tab === 'draw' && (
            <>
              <div className="fw-motto">牌不预言结果，只是把你已经知道的事摆到眼前。</div>

              <div className="fw-chips">
                {SPREAD_OPTIONS.map((s) => (
                  <button
                    key={s.n}
                    className={'fw-chip' + (spread === s.n ? ' on' : '')}
                    onClick={() => { if (!drawing) setSpread(s.n) }}
                    title={s.hint}
                  >{s.name}</button>
                ))}
              </div>

              <input
                className="tarot-question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="想问点什么？（可以不写）"
                maxLength={100}
                disabled={drawing}
              />

              {draw && (
                <div className={'tarot-spread n' + draw.spread}>
                  {draw.cards.map((c, i) => (
                    <TarotCard
                      key={i}
                      card={c}
                      label={draw.labels?.[i]}
                      flipped={i < flipped}
                      expanded={open === i}
                      onToggle={() => setOpen(open === i ? null : i)}
                    />
                  ))}
                </div>
              )}

              <button className="btn-primary fw-lever" onClick={doDraw} disabled={drawing}>
                {drawing ? '洗牌中…' : draw ? '再抽一次' : '抽牌'}
              </button>

              {draw && flipped >= draw.cards.length && (
                <div className="fate-actions">
                  <button className="roost-btn fate-go" onClick={askReading}>🐦‍⬛ 让爸比解牌</button>
                  <button className="roost-btn" onClick={copyDraw}>复制</button>
                </div>
              )}
            </>
          )}

          {tab === 'history' && <History config={moonMemory} onReask={(d) => { setDraw(d); setFlipped(d.cards.length); setTab('draw') }} />}
          {tab === 'deck' && <Encyclopedia />}
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}

// ── 一张牌 ────────────────────────────────────────────────────────────────

function TarotCard({ card, label, flipped, expanded, onToggle }) {
  return (
    <div className={'tarot-card' + (flipped ? ' flipped' : '') + (card.reversed ? ' rev' : '')}>
      {label && <div className="tarot-card-label">{label}</div>}
      {!flipped ? (
        <div className="tarot-card-back"><span>✦</span></div>
      ) : (
        <div className="tarot-card-front" onClick={onToggle}>
          <div className="tarot-card-numeral">{card.numeral}</div>
          <div className="tarot-card-name">{card.nameCn}</div>
          <div className="tarot-card-en">{card.nameEn}</div>
          <div className={'tarot-card-orient' + (card.reversed ? ' rev' : '')}>
            {card.reversed ? '逆位' : '正位'}
          </div>
          <div className="tarot-card-kw">{card.keywords}</div>
          {expanded && <div className="tarot-card-meaning">{card.meaning}</div>}
          {card.meaning && <div className="tarot-card-more">{expanded ? '收起' : '看牌义'}</div>}
        </div>
      )}
    </div>
  )
}

// ── 牌记 ──────────────────────────────────────────────────────────────────

function History({ config, onReask }) {
  const [draws, setDraws] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)

  useEffect(() => {
    fetchTarotDraws(config, { limit: 30 })
      .then((d) => setDraws(Array.isArray(d) ? d : []))
      .catch((e) => setErr(e.message))
  }, [config])

  async function remove(id) {
    try {
      await deleteTarotDraw(config, id)
      setDraws((ds) => ds.filter((d) => d.id !== id))
    } catch (e) { showToast('删不掉：' + e.message, 'error') }
  }

  if (err) return <div className="tarot-empty">牌记读不出来：{err}</div>
  if (!draws) return <div className="tarot-empty">翻牌记中…</div>
  if (!draws.length) return <div className="tarot-empty">还没有抽过牌。</div>

  return (
    <div className="tarot-history">
      {draws.map((d) => (
        <div key={d.id} className={'tarot-hist-item' + (open === d.id ? ' open' : '')}>
          <div className="tarot-hist-head" onClick={() => setOpen(open === d.id ? null : d.id)}>
            <span className="tarot-hist-who">{d.drawn_by}</span>
            <span className="tarot-hist-sum">{drawSummary(d)}</span>
            <span className="tarot-hist-date">{(d.created_at || '').slice(5, 10)}</span>
          </div>
          {open === d.id && (
            <div className="tarot-hist-body">
              {d.question && <div className="tarot-hist-q">问：{d.question}</div>}
              {d.cards.map((c, i) => (
                <div key={i} className="tarot-hist-card">
                  <b>{d.labels?.[i] ? `【${d.labels[i]}】` : ''}{cardTitle(c)}</b>
                  <span>{c.meaning || c.keywords}</span>
                </div>
              ))}
              {d.reading
                ? <div className="tarot-hist-reading">{d.reading}</div>
                : <div className="tarot-hist-noread">这次还没解过</div>}
              <div className="tarot-hist-actions">
                <button className="roost-btn" onClick={() => onReask(d)}>放回牌桌</button>
                <button className="roost-btn tarot-del" onClick={() => remove(d.id)}>删除</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── 图鉴 ──────────────────────────────────────────────────────────────────

function Encyclopedia() {
  const [deck, setDeck] = useState(null)
  const [err, setErr] = useState('')
  const [suit, setSuit] = useState('major')
  const [open, setOpen] = useState(null)

  useEffect(() => { loadDeck().then(setDeck).catch((e) => setErr(e.message)) }, [])

  if (err) return <div className="tarot-empty">牌库没加载出来：{err}</div>
  if (!deck) return <div className="tarot-empty">摊开牌库…</div>

  const cards = deck.cards.filter((c) => c.suit === suit)

  return (
    <>
      <div className="fw-chips">
        {Object.entries(SUIT_CN).map(([k, cn]) => (
          <button key={k} className={'fw-chip' + (suit === k ? ' on' : '')} onClick={() => { setSuit(k); setOpen(null) }}>{cn}</button>
        ))}
      </div>
      <div className="tarot-ency">
        {cards.map((c) => (
          <div key={c.id} className={'tarot-ency-item' + (open === c.id ? ' open' : '')}>
            <div className="tarot-ency-head" onClick={() => setOpen(open === c.id ? null : c.id)}>
              <span className="tarot-ency-num">{c.numeral}</span>
              <span className="tarot-ency-name">{c.nameCn}</span>
              <span className="tarot-ency-en">{c.nameEn}</span>
            </div>
            {open === c.id && (
              <div className="tarot-ency-body">
                <div className="tarot-ency-sec"><b>正位</b>{c.upright.keywords}<p>{c.upright.meaning}</p></div>
                <div className="tarot-ency-sec rev"><b>逆位</b>{c.reversed.keywords}<p>{c.reversed.meaning}</p></div>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
