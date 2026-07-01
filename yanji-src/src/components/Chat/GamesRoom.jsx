import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { showToast } from '../Toast'

const PLAYER_LABELS = { cc: '服务器·阿言', chat: '对话·阿言' }
const STATUS_LABELS = { playing: '进行中', paused: '暂停', ended: '已结束' }
const ICON_CHOICES = ['🎮', '🪷', '🎣', '🐟', '🌱', '🕹️', '🎲', '🏝️', '🐦', '🌾']

function parseAttrs(raw) {
  if (!raw) return []
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

const emptyForm = { name: '', icon: '🎮', player: 'chat', status: 'playing', summary: '', progress: '', attrs: [] }

export default function GamesRoom({ onClose }) {
  const moonMemory = useStore((s) => s.moonMemory)
  const base = (moonMemory?.apiUrl || 'https://memory.ravenlove.cc').replace(/\/$/, '')
  const token = moonMemory?.apiToken

  const [view, setView] = useState('list')   // list | detail | form
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [current, setCurrent] = useState(null)   // detail game (with logs)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [logDraft, setLogDraft] = useState({ day_label: '', note: '' })

  const auth = { Authorization: `Bearer ${token}` }

  const loadList = useCallback(async () => {
    if (!token) { setLoading(false); return }
    setLoading(true)
    try {
      const r = await fetch(`${base}/games`, { headers: auth })
      setGames(r.ok ? await r.json() : [])
    } catch { setGames([]) }
    setLoading(false)
  }, [base, token])

  useEffect(() => { loadList() }, [loadList])

  async function openDetail(id) {
    try {
      const r = await fetch(`${base}/games/${id}`, { headers: auth })
      if (!r.ok) return showToast('读取失败', 'error')
      setCurrent(await r.json())
      setView('detail')
    } catch { showToast('读取失败', 'error') }
  }

  function startCreate() {
    setForm(emptyForm); setEditingId(null); setView('form')
  }
  function startEdit(g) {
    setForm({
      name: g.name || '', icon: g.icon || '🎮', player: g.player || 'chat',
      status: g.status || 'playing', summary: g.summary || '', progress: g.progress || '',
      attrs: parseAttrs(g.attributes),
    })
    setEditingId(g.id); setView('form')
  }

  async function submitForm() {
    if (!token) return showToast('未配置记忆库 Token', 'error')
    if (!form.name.trim()) return showToast('给游戏起个名字吧', 'error')
    const body = {
      name: form.name.trim(), icon: form.icon, player: form.player, status: form.status,
      summary: form.summary.trim(), progress: form.progress.trim(),
      attributes: form.attrs.filter((a) => a.label?.trim() || a.value?.trim()),
    }
    try {
      const url = editingId ? `${base}/games/${editingId}` : `${base}/games`
      const r = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) return showToast('保存失败', 'error')
      const saved = await r.json()
      await loadList()
      setCurrent(editingId ? saved : { ...saved, logs: [] })
      setView('detail')
    } catch { showToast('保存失败', 'error') }
  }

  async function removeGame(id) {
    if (!confirm('确定删除这个游戏档案吗？进度记录也会一起删掉')) return
    try {
      await fetch(`${base}/games/${id}`, { method: 'DELETE', headers: auth })
      await loadList(); setView('list')
    } catch { showToast('删除失败', 'error') }
  }

  async function addLog() {
    if (!logDraft.note.trim()) return
    try {
      const r = await fetch(`${base}/games/${current.id}/logs`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(logDraft),
      })
      if (!r.ok) return showToast('添加失败', 'error')
      const log = await r.json()
      setCurrent((c) => ({ ...c, logs: [log, ...(c.logs || [])] }))
      setLogDraft({ day_label: '', note: '' })
    } catch { showToast('添加失败', 'error') }
  }

  async function removeLog(logId) {
    try {
      await fetch(`${base}/games/logs/${logId}`, { method: 'DELETE', headers: auth })
      setCurrent((c) => ({ ...c, logs: (c.logs || []).filter((l) => l.id !== logId) }))
    } catch { showToast('删除失败', 'error') }
  }

  // 属性行编辑
  function setAttr(i, key, val) {
    setForm((f) => ({ ...f, attrs: f.attrs.map((a, idx) => idx === i ? { ...a, [key]: val } : a) }))
  }
  function addAttrRow() { setForm((f) => ({ ...f, attrs: [...f.attrs, { label: '', value: '' }] })) }
  function delAttrRow(i) { setForm((f) => ({ ...f, attrs: f.attrs.filter((_, idx) => idx !== i) })) }

  const body = (
    <div className="roost-overlay" onClick={onClose}>
      <div className="roost-modal roost-modal-tall games-modal" onClick={(e) => e.stopPropagation()}>

        {/* header */}
        <div className="roost-modal-header">
          {view === 'list' ? (
            <span>🎮 游戏室</span>
          ) : (
            <button className="games-back" onClick={() => setView(view === 'form' && editingId ? 'detail' : 'list')}>‹ 返回</button>
          )}
          <button className="roost-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="roost-modal-body">
          {/* ── 列表 ── */}
          {view === 'list' && (
            loading ? <div className="games-empty">载入中…</div> : (
              <>
                {games.length === 0 && <div className="games-empty">还没有游戏档案，点下面新建一个吧</div>}
                {games.map((g) => (
                  <div key={g.id} className={'games-card' + (g.status === 'ended' ? ' ended' : '')} onClick={() => openDetail(g.id)}>
                    <span className="games-card-icon">{g.icon || '🎮'}</span>
                    <div className="games-card-main">
                      <div className="games-card-name">{g.name}
                        <span className={'games-badge games-badge-' + g.player}>{PLAYER_LABELS[g.player] || g.player}</span>
                      </div>
                      <div className="games-card-progress">{g.progress || g.summary || STATUS_LABELS[g.status]}</div>
                    </div>
                    <span className={'games-dot games-dot-' + g.status} title={STATUS_LABELS[g.status]} />
                  </div>
                ))}
                <button className="roost-btn games-add" onClick={startCreate}>＋ 新游戏</button>
              </>
            )
          )}

          {/* ── 详情 ── */}
          {view === 'detail' && current && (
            <>
              <div className="games-detail-head">
                <span className="games-detail-icon">{current.icon || '🎮'}</span>
                <div>
                  <div className="games-detail-name">{current.name}</div>
                  <div className="games-detail-meta">
                    <span className={'games-badge games-badge-' + current.player}>{PLAYER_LABELS[current.player]}</span>
                    <span className="games-detail-status">{STATUS_LABELS[current.status]}</span>
                  </div>
                </div>
              </div>
              {current.summary && <div className="games-detail-summary">{current.summary}</div>}
              {current.progress && <div className="games-detail-progress">当前：{current.progress}</div>}

              {/* 属性板 */}
              {parseAttrs(current.attributes).length > 0 && (
                <div className="games-attr-board">
                  {parseAttrs(current.attributes).map((a, i) => (
                    <div key={i} className="games-attr">
                      <span className="games-attr-label">{a.label}</span>
                      <span className="games-attr-value">{a.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 进度时间线 */}
              <div className="games-section-title">进度</div>
              <div className="games-log-add">
                <input className="games-input games-input-sm" placeholder="标签（如 第104天·冬）"
                  value={logDraft.day_label} onChange={(e) => setLogDraft((d) => ({ ...d, day_label: e.target.value }))} />
                <div className="games-log-add-row">
                  <input className="games-input" placeholder="记一笔进展/感想…"
                    value={logDraft.note} onChange={(e) => setLogDraft((d) => ({ ...d, note: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && addLog()} />
                  <button className="roost-btn games-log-btn" onClick={addLog}>记</button>
                </div>
              </div>
              <div className="games-timeline">
                {(current.logs || []).length === 0 && <div className="games-empty-sm">还没有进度记录</div>}
                {(current.logs || []).map((l) => (
                  <div key={l.id} className="games-log">
                    <div className="games-log-top">
                      {l.day_label && <span className="games-log-day">{l.day_label}</span>}
                      <span className="games-log-time">{(l.created_at || '').slice(5, 10)}</span>
                      <button className="games-log-del" onClick={() => removeLog(l.id)}>✕</button>
                    </div>
                    <div className="games-log-note">{l.note}</div>
                  </div>
                ))}
              </div>

              <div className="games-detail-actions">
                <button className="roost-btn" onClick={() => startEdit(current)}>编辑档案</button>
                <button className="roost-btn roost-btn-danger" onClick={() => removeGame(current.id)}>删除</button>
              </div>
            </>
          )}

          {/* ── 表单 ── */}
          {view === 'form' && (
            <>
              <label className="games-flabel">游戏名</label>
              <input className="games-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="比如 钓鱼、CedarEco…" />

              <label className="games-flabel">图标</label>
              <div className="games-icon-row">
                {ICON_CHOICES.map((ic) => (
                  <button key={ic} className={'games-icon-opt' + (form.icon === ic ? ' on' : '')}
                    onClick={() => setForm((f) => ({ ...f, icon: ic }))}>{ic}</button>
                ))}
              </div>

              <div className="games-form-2col">
                <div>
                  <label className="games-flabel">谁在玩</label>
                  <select className="games-input" value={form.player} onChange={(e) => setForm((f) => ({ ...f, player: e.target.value }))}>
                    <option value="chat">对话·阿言</option>
                    <option value="cc">服务器·阿言</option>
                  </select>
                </div>
                <div>
                  <label className="games-flabel">状态</label>
                  <select className="games-input" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                    <option value="playing">进行中</option>
                    <option value="paused">暂停</option>
                    <option value="ended">已结束</option>
                  </select>
                </div>
              </div>

              <label className="games-flabel">一句话简介</label>
              <input className="games-input" value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} placeholder="这是个什么游戏" />

              <label className="games-flabel">当前进度</label>
              <input className="games-input" value={form.progress} onChange={(e) => setForm((f) => ({ ...f, progress: e.target.value }))} placeholder="玩到哪了" />

              <label className="games-flabel">属性板</label>
              {form.attrs.map((a, i) => (
                <div key={i} className="games-attr-edit">
                  <input className="games-input games-input-sm" placeholder="项" value={a.label} onChange={(e) => setAttr(i, 'label', e.target.value)} />
                  <input className="games-input games-input-sm" placeholder="值" value={a.value} onChange={(e) => setAttr(i, 'value', e.target.value)} />
                  <button className="games-attr-del" onClick={() => delAttrRow(i)}>✕</button>
                </div>
              ))}
              <button className="games-attr-add" onClick={addAttrRow}>＋ 加一项属性</button>

              <button className="roost-btn games-save" onClick={submitForm}>{editingId ? '保存修改' : '创建游戏'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
