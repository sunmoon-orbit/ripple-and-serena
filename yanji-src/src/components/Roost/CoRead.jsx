import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '../../store'
import { showToast } from '../Toast'
import {
  fetchArchiveConversations, fetchArchiveConversation,
  fetchAnnotations, createAnnotation, deleteAnnotation,
  fetchBookmark, saveBookmark,
} from '../../api/moonMemory'

const COLORS = [
  { id: 'yellow', hex: '#f5d76e' },
  { id: 'pink', hex: '#f0a6c0' },
  { id: 'blue', hex: '#9ec5e8' },
  { id: 'green', hex: '#a8d8b0' },
]
const COLOR_HEX = Object.fromEntries(COLORS.map((c) => [c.id, c.hex]))

const SOURCE_LABEL = { claude_ai: 'Claude', yanji: '言叽', raven: '归巢', claude_code: 'CC' }

// 共读视角下的称呼：human=阿颖，assistant=涟言
function roleName(role) {
  return role === 'human' || role === 'user' ? '阿颖' : '涟言'
}

export default function CoRead({ onClose }) {
  const moonMemory = useStore((s) => s.moonMemory)
  const cfg = { baseUrl: (moonMemory?.baseUrl || 'https://memory.ravenlove.cc').replace(/\/$/, ''), apiToken: moonMemory?.apiToken }

  const [convs, setConvs] = useState(null)   // null=loading
  const [active, setActive] = useState(null) // 选中的对话 {id,title,...}
  const [messages, setMessages] = useState([])
  const [annos, setAnnos] = useState([])     // 当前对话的标注
  const [loadingConv, setLoadingConv] = useState(false)
  const [annoTarget, setAnnoTarget] = useState(null) // 正在标注的消息 id
  const [annoColor, setAnnoColor] = useState('yellow')
  const [annoNote, setAnnoNote] = useState('')
  // 界面前的人是阿颖，署名默认她；之前写死'涟言'把她的批注全记在我头上（2026-07-03 修）
  const [annoAuthor, setAnnoAuthor] = useState('阿颖')
  const [bookmark, setBookmark] = useState(null)
  const msgRefs = useRef({})

  // 加载对话列表
  useEffect(() => {
    if (!cfg.apiToken) { setConvs([]); return }
    fetchArchiveConversations(cfg)
      .then((list) => setConvs(Array.isArray(list) ? list : []))
      .catch(() => setConvs([]))
  }, [])

  const openConv = useCallback(async (conv) => {
    setActive(conv)
    setLoadingConv(true)
    try {
      const [full, annoList, bm] = await Promise.all([
        fetchArchiveConversation(cfg, conv.id),
        fetchAnnotations(cfg, conv.id).catch(() => []),
        fetchBookmark(cfg, conv.id).catch(() => null),
      ])
      setMessages(full.messages || [])
      setAnnos(annoList || [])
      setBookmark(bm)
    } catch {
      showToast('加载对话失败', 'error')
    } finally {
      setLoadingConv(false)
    }
  }, [])

  // 进入对话后滚到书签位置
  useEffect(() => {
    if (!loadingConv && bookmark?.message_id && msgRefs.current[bookmark.message_id]) {
      setTimeout(() => msgRefs.current[bookmark.message_id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200)
    }
  }, [loadingConv, bookmark])

  const annosByMsg = annos.reduce((acc, a) => {
    (acc[a.message_id] = acc[a.message_id] || []).push(a); return acc
  }, {})

  async function submitAnno() {
    if (!annoTarget) return
    try {
      const created = await createAnnotation(cfg, active.id, {
        message_id: annoTarget, author: annoAuthor, color: annoColor, note: annoNote.trim(),
      })
      setAnnos((prev) => [...prev, created])
      setAnnoTarget(null); setAnnoNote(''); setAnnoColor('yellow')
    } catch { showToast('标注失败', 'error') }
  }

  async function removeAnno(id) {
    try {
      await deleteAnnotation(cfg, id)
      setAnnos((prev) => prev.filter((a) => a.id !== id))
    } catch { showToast('删除失败', 'error') }
  }

  async function markBookmark(msgId) {
    try {
      await saveBookmark(cfg, active.id, msgId, '阿颖')
      setBookmark({ message_id: msgId, updated_by: '阿颖' })
      showToast('书签已记在这里')
    } catch { showToast('书签保存失败', 'error') }
  }

  // ── 对话列表视图 ──
  if (!active) {
    return (
      <div className="roost-overlay" onClick={onClose}>
        <div className="roost-modal roost-modal-tall coread-modal" onClick={(e) => e.stopPropagation()}>
          <div className="roost-modal-header">
            <span>共读 · 一起翻旧时光</span>
            <button className="roost-modal-close" onClick={onClose}>✕</button>
          </div>
          <div className="roost-modal-body">
            {convs === null && <div className="roost-empty">加载中……</div>}
            {convs?.length === 0 && <div className="roost-empty">还没有可共读的对话（先导入历史记录）</div>}
            <div className="coread-conv-list">
              {convs?.map((c) => (
                <div key={c.id} className="coread-conv-item" onClick={() => openConv(c)}>
                  <div className="coread-conv-title">{c.title || '（无题）'}</div>
                  <div className="coread-conv-meta">
                    <span className="coread-conv-source">{SOURCE_LABEL[c.source] || c.source}</span>
                    <span className="coread-conv-date">{(c.created_at || '').slice(0, 10)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── 阅读视图 ──
  return (
    <div className="roost-overlay" onClick={onClose}>
      <div className="roost-modal roost-modal-tall coread-modal coread-reader" onClick={(e) => e.stopPropagation()}>
        <div className="roost-modal-header">
          <button className="coread-back" onClick={() => { setActive(null); setMessages([]); setAnnos([]) }}>‹ 返回</button>
          <span className="coread-reader-title">{active.title || '（无题）'}</span>
          <button className="roost-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="roost-modal-body coread-stream">
          {loadingConv && <div className="roost-empty">展开旧时光……</div>}
          {!loadingConv && messages.map((m) => {
            const mine = m.role !== 'human' && m.role !== 'user'
            const msgAnnos = annosByMsg[m.id] || []
            const isBookmarked = bookmark?.message_id === m.id
            return (
              <div
                key={m.id}
                ref={(el) => { msgRefs.current[m.id] = el }}
                className={'coread-msg' + (mine ? ' mine' : ' hers') + (isBookmarked ? ' bookmarked' : '')}
              >
                <div className="coread-msg-role">{roleName(m.role)}</div>
                <div
                  className="coread-bubble"
                  style={msgAnnos.length ? { boxShadow: `inset 4px 0 0 ${COLOR_HEX[msgAnnos[0].color] || '#f5d76e'}` } : undefined}
                  onClick={() => { setAnnoTarget(m.id); setAnnoNote(''); setAnnoColor('yellow') }}
                >
                  {m.content}
                </div>
                {msgAnnos.map((a) => (
                  <div key={a.id} className="coread-anno" style={{ borderLeftColor: COLOR_HEX[a.color] || '#f5d76e' }}>
                    <span className="coread-anno-author">{a.author}</span>
                    <span className="coread-anno-note">{a.note || '（高亮）'}</span>
                    <button className="coread-anno-del" onClick={() => removeAnno(a.id)}>✕</button>
                  </div>
                ))}
                <div className="coread-msg-tools">
                  <button onClick={() => { setAnnoTarget(m.id); setAnnoNote(''); setAnnoColor('yellow') }}>批注</button>
                  <button onClick={() => markBookmark(m.id)}>{isBookmarked ? '✓ 书签' : '夹书签'}</button>
                </div>
              </div>
            )
          })}
        </div>

        {/* 标注输入浮层 */}
        {annoTarget && (
          <div className="coread-anno-compose" onClick={(e) => e.stopPropagation()}>
            <div className="coread-color-row">
              {COLORS.map((c) => (
                <button
                  key={c.id}
                  className={'coread-color-dot' + (annoColor === c.id ? ' active' : '')}
                  style={{ background: c.hex }}
                  onClick={() => setAnnoColor(c.id)}
                />
              ))}
              <div className="bookread-author-toggle">
                {['阿颖', '涟言'].map((who) => (
                  <button key={who} className={annoAuthor === who ? 'active' : ''} onClick={() => setAnnoAuthor(who)}>{who}</button>
                ))}
              </div>
            </div>
            <textarea
              className="coread-anno-input"
              placeholder="写一句批注（留空＝纯高亮）……"
              value={annoNote}
              onChange={(e) => setAnnoNote(e.target.value)}
              rows={2}
              autoFocus
            />
            <div className="coread-anno-actions">
              <button className="roost-btn roost-btn-ghost roost-btn-sm" onClick={() => setAnnoTarget(null)}>取消</button>
              <button className="roost-btn roost-btn-sm" onClick={submitAnno}>留下</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
