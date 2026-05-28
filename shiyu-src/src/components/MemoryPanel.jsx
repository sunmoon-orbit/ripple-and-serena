import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { showToast } from './Toast'
import { Plus, RefreshCw, Search, Clock, Pencil, Trash2 } from 'lucide-react'

export const SCOPES = { shared: '共享', private_阿颖: '阿颖私密', private_阿言: '阿言私密' }
export const LAYERS = { core: '核心', long: '长期', short: '短期', consciousness: '意识' }
const META = new Set(['core', 'long', 'short', 'consciousness', 'shared', 'private_阿颖', 'private_阿言', '阿言', '阿颖'])

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(String(s).replace(' ', 'T'))
  if (isNaN(d)) return String(s).slice(0, 10)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 3600) return Math.max(1, Math.floor(diff / 60)) + ' 分钟前'
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前'
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前'
  return d.toLocaleDateString('zh-CN')
}

function useClock() {
  const [t, setT] = useState('')
  useEffect(() => {
    const upd = () => setT(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()))
    upd()
    const i = setInterval(upd, 30000)
    return () => clearInterval(i)
  }, [])
  return t
}

function Heatmap({ data }) {
  const days = []
  for (let i = 83; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    days.push({ key: d.toISOString().slice(0, 10), n: data[d.toISOString().slice(0, 10)] || 0 })
  }
  return (
    <div className="heatmap-wrap">
      <div className="heatmap">
        {days.map((d) => {
          const op = d.n ? Math.min(0.25 + (d.n / 6) * 0.75, 1) : 0
          return <div key={d.key} className="heatmap-cell" title={`${d.key}: ${d.n} 条`}
            style={op ? { background: 'var(--olive)', opacity: op } : undefined} />
        })}
      </div>
    </div>
  )
}

function Editor({ initial, onClose, onSaved }) {
  const isEdit = !!initial?.id
  const [content, setContent] = useState(initial?.content || '')
  const [tags, setTags] = useState(initial?.tags || '')
  const [scope, setScope] = useState(initial?.scope || 'shared')
  const [layer, setLayer] = useState(initial?.layer || '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!content.trim()) return showToast('内容不能为空', 'error')
    setSaving(true)
    try {
      if (isEdit) await api.update(initial.id, { content: content.trim(), tags, scope, layer: layer || null })
      else await api.create({ content: content.trim(), tags, scope, layer: layer || null, owner: '阿颖', agent: '阿言' })
      showToast(isEdit ? '已更新' : '已记下', 'success')
      onSaved()
    } catch (e) { showToast(e.message, 'error') } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{isEdit ? '编辑记忆' : '新记忆'}</div>
        <textarea className="textarea" rows={5} value={content} autoFocus placeholder="记忆内容…" onChange={(e) => setContent(e.target.value)} />
        <div style={{ marginTop: 12 }}>
          <input className="input" value={tags} placeholder="标签（逗号分隔）" onChange={(e) => setTags(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <select className="select" style={{ flex: 1 }} value={scope} onChange={(e) => setScope(e.target.value)}>
            {Object.entries(SCOPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="select" style={{ flex: 1 }} value={layer} onChange={(e) => setLayer(e.target.value)}>
            <option value="">无层级</option>
            {Object.entries(LAYERS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>
  )
}

function Card({ m, onEdit, onTrash }) {
  const [exp, setExp] = useState(false)
  const tags = (m.tags || '').split(',').map((t) => t.trim()).filter((t) => t && !META.has(t))
  const long = (m.content || '').length > 300
  return (
    <div className="card">
      <div className={'card-content' + (exp ? ' expanded' : '')}>
        {m.content}
        {long && !exp && <div className="card-fade" />}
      </div>
      {long && <div className="card-more" onClick={() => setExp(!exp)}>{exp ? '收起' : '展开全文'}</div>}
      {tags.length > 0 && <div className="tags">{tags.map((t, i) => <span key={i} className="tag">{t}</span>)}</div>}
      <div className="card-footer">
        <div className="badges">
          {m.layer && <span className="badge badge-layer">{LAYERS[m.layer] || m.layer}</span>}
          <span className="badge badge-scope">{SCOPES[m.scope] || m.scope}</span>
          {m.agent && <span className="badge badge-agent">{m.agent}</span>}
        </div>
        <div className="card-meta">
          <span className="card-date">{fmtDate(m.created_at)}</span>
          <div className="card-acts">
            <button className="icon-btn" onClick={() => onEdit(m)}><Pencil size={15} /></button>
            <button className="icon-btn danger" onClick={() => onTrash(m)}><Trash2 size={15} /></button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function MemoryPanel() {
  const clock = useClock()
  const [mems, setMems] = useState([])
  const [heat, setHeat] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [scope, setScope] = useState('')
  const [layer, setLayer] = useState('')
  const [editor, setEditor] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [m, h] = await Promise.all([api.list({ q, scope, layer, limit: 200 }), api.heatmap()])
      setMems(m); setHeat(h)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [q, scope, layer])

  useEffect(() => { load() }, [load])

  async function trash(m) {
    if (!confirm('移入回收站？')) return
    try { await api.moveToTrash(m.id); showToast('已移入回收站'); load() }
    catch (e) { showToast(e.message, 'error') }
  }

  return (
    <div className="panel">
      <div className="topbar">
        <h1>拾羽记忆库</h1>
        <div className="topbar-actions">
          {clock && <span className="clock"><Clock size={13} />{clock}</span>}
          <button className="btn-icon" onClick={load}><RefreshCw size={17} className={loading ? 'spin' : ''} /></button>
          <button className="btn-icon" style={{ background: 'var(--olive-deep)', color: '#fff' }} onClick={() => setEditor({ _new: true })}><Plus size={18} /></button>
        </div>
      </div>

      <Heatmap data={heat} />
      <div className="heatmap-legend">过去 12 周 · {mems.length} 条记忆</div>

      <div className="filters" style={{ marginTop: 14 }}>
        <div className="search-box">
          <Search size={15} />
          <input value={q} placeholder="搜索记忆…" onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">全部范围</option>
          {Object.entries(SCOPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="select" value={layer} onChange={(e) => setLayer(e.target.value)}>
          <option value="">全部层</option>
          {Object.entries(LAYERS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {error && <div className="error-box">{error}</div>}
      {!error && mems.length === 0 && !loading && <div className="empty">暂无记忆</div>}

      <div className="mem-list">
        {mems.map((m) => <Card key={m.id} m={m} onEdit={setEditor} onTrash={trash} />)}
      </div>

      {editor && <Editor initial={editor._new ? null : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); load() }} />}
    </div>
  )
}
