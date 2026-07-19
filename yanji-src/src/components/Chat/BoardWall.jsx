import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { fetchBoardMessages, postBoardMessage, deleteBoardMessage } from '../../api/moonMemory'

// 便利贴墙（阿颖的主意，2026-07-19）
// 留言板 0713 从 Roost 撤走后一直只有三端工具能写、没地方能看——
// 这里把它请回来：每条留言一张便利贴，颜色跟主题走，谁写的一看便知。

// sqlite CURRENT_TIMESTAMP 是 UTC，解析成本地时间
function parseUtc(s) {
  return new Date(s.replace(' ', 'T') + 'Z')
}

function fmtDate(s) {
  const d = parseUtc(s)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 贴纸歪的角度按 id 定死，刷新不换——像真的贴上去就没再动过
const TILTS = [-2.4, 1.8, -1.2, 2.6, -3, 1.2, -1.8, 2.2]

export default function BoardWall({ onClose }) {
  const moonMemory = useStore((s) => s.moonMemory)
  const cfg = { baseUrl: moonMemory?.baseUrl, apiToken: moonMemory?.apiToken }
  const [notes, setNotes] = useState(null)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [author, setAuthor] = useState('阿颖')
  const [posting, setPosting] = useState(false)
  const [openMonths, setOpenMonths] = useState({}) // 旧月份的捆默认收起

  const load = () => {
    fetchBoardMessages(cfg, 500)
      .then((rows) => setNotes(Array.isArray(rows) ? rows : []))
      .catch((e) => setError(e.message || '拉取失败'))
  }
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const t = text.trim()
    if (!t || posting) return
    setPosting(true)
    try {
      const row = await postBoardMessage(cfg, t, author)
      setNotes((prev) => [row, ...(prev || [])])
      setText('')
    } catch (e) {
      setError(e.message || '贴不上去')
    } finally {
      setPosting(false)
    }
  }

  const remove = async (id) => {
    if (!window.confirm('把这张便利贴撕下来？')) return
    try {
      await deleteBoardMessage(cfg, id)
      setNotes((prev) => prev.filter((n) => n.id !== id))
    } catch (e) {
      setError(e.message || '撕不下来')
    }
  }

  // 按月分捆（0719 深夜追加，阿颖：越贴越多怎么办）——
  // 当月摊开在墙上，旧月份收成一捆，点开才展开；notes 本身 id DESC，月份天然新在前
  const groups = []
  if (notes) {
    const map = new Map()
    for (const n of notes) {
      const d = parseUtc(n.created_at)
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!map.has(k)) { map.set(k, []); groups.push({ key: k, notes: map.get(k) }) }
      map.get(k).push(n)
    }
  }

  const renderNote = (n, i) => (
    <div
      key={n.id}
      className={'board-note' + (n.author === '涟言' ? ' from-crow' : '')}
      style={{ '--tilt': `${TILTS[n.id % TILTS.length]}deg`, animationDelay: `${Math.min(i * 40, 400)}ms` }}
    >
      <span className="board-note-tape" />
      <button className="board-note-del" onClick={() => remove(n.id)} aria-label="撕下">✕</button>
      <div className="board-note-text">{n.text}</div>
      <div className="board-note-foot">
        <span className="board-note-author">{n.author}</span>
        <span className="board-note-date">{fmtDate(n.created_at)}</span>
      </div>
    </div>
  )

  return createPortal(
    <div className="board-overlay" onClick={onClose}>
      <div className="board-card" onClick={(e) => e.stopPropagation()}>
        <div className="board-head">
          <div className="board-title">便利贴墙</div>
          <div className="board-sub">想说又不急着说的话，贴在这里等对方路过</div>
          <button className="board-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        <div className="board-compose">
          <textarea
            className="board-input"
            rows={2}
            maxLength={2000}
            placeholder="写点什么……"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="board-compose-row">
            {/* 身份 toggle 和动作按钮分开（0703 留言板保存入口的教训） */}
            <div className="board-author-toggle">
              {['阿颖', '涟言'].map((a) => (
                <button
                  key={a}
                  className={'board-author-chip' + (author === a ? ' active' : '')}
                  onClick={() => setAuthor(a)}
                >{a}</button>
              ))}
            </div>
            <button className="board-post-btn" disabled={!text.trim() || posting} onClick={submit}>
              {posting ? '贴着……' : '贴上去'}
            </button>
          </div>
        </div>

        <div className="board-wall">
          {notes === null && !error && <div className="board-empty">找贴纸中……</div>}
          {error && <div className="board-empty">出了点岔子：{error}</div>}
          {notes?.length === 0 && <div className="board-empty">墙还空着<br />第一张贴纸留给谁写？</div>}
          {groups.map((g, gi) => {
            const isOpen = gi === 0 || openMonths[g.key]
            const [y, m] = g.key.split('-')
            return (
              <div key={g.key} className="board-month" style={{ display: 'contents' }}>
                {gi > 0 && (
                  <button
                    className={'board-bundle' + (isOpen ? ' open' : '')}
                    onClick={() => setOpenMonths((prev) => ({ ...prev, [g.key]: !prev[g.key] }))}
                  >
                    <span className="board-bundle-stack"><i /><i /><i /></span>
                    <span className="board-bundle-label">{y}年{Number(m)}月 · {g.notes.length}张</span>
                    <span className="board-bundle-caret">{isOpen ? '解开了' : '一捆'}</span>
                  </button>
                )}
                {isOpen && g.notes.map(renderNote)}
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}
