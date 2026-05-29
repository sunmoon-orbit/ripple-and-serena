import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { showToast } from './Toast'
import { Plus, RefreshCw, Search, Clock, Pencil, Trash2 } from 'lucide-react'

export const SCOPES = { shared: '共享', private_阿颖: '阿颖私密', private_阿言: '阿言私密' }
export const LAYERS = { core: '核心', long: '长期', short: '短期', consciousness: '意识' }
const LAYER_COLORS = { core: '#D94040', long: '#D87830', short: '#C0A020', consciousness: '#8848C0' }
const META = new Set(['core', 'long', 'short', 'consciousness', 'shared', 'private_阿颖', 'private_阿言', '阿言', '阿颖'])

const IMP_OPTS = [{ v: 10, l: '珍藏' }, { v: 7, l: '重要' }, { v: 5, l: '普通' }, { v: 3, l: '琐碎' }]

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
    const upd = () => setT(new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(new Date()))
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
            style={op ? { background: 'var(--olive-active)', opacity: op } : undefined} />
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
  const [importance, setImportance] = useState(initial?.importance || 5)
  const [memorable, setMemorable] = useState((initial?.arousal || 0) > 0.6)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!content.trim()) return showToast('内容不能为空', 'error')
    setSaving(true)
    const fields = { content: content.trim(), tags, scope, layer: layer || null, importance, arousal: memorable ? 0.85 : 0.3 }
    try {
      if (isEdit) await api.update(initial.id, fields)
      else await api.create({ ...fields, owner: '阿颖', agent: '阿言' })
      showToast(isEdit ? '已更新' : '已记下', 'success')
      onSaved()
    } catch (e) { showToast(e.message, 'error') } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{isEdit ? '编辑记忆' : '新记忆'}</div>
        <textarea className="textarea" rows={5} value={content} autoFocus
          placeholder="记忆内容…" onChange={(e) => setContent(e.target.value)} />
        <div style={{ marginTop: 12 }}>
          <input className="input" value={tags} placeholder="标签（逗号分隔）"
            onChange={(e) => setTags(e.target.value)} />
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
        <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
          <select className="select" style={{ flex: 1 }} value={importance}
            onChange={(e) => setImportance(Number(e.target.value))}>
            {IMP_OPTS.map((o) => <option key={o.v} value={o.v}>重要程度：{o.l}</option>)}
          </select>
          <label className="memorable-toggle" onClick={() => setMemorable(!memorable)}>
            <span className={'toggle' + (memorable ? ' on' : '')} />
            <span>难忘</span>
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Card({ m, onEdit, onTrash }) {
  const [exp, setExp] = useState(false)
  const tags = (m.tags || '').split(',').map((t) => t.trim()).filter((t) => t && !META.has(t))
  const long = (m.content || '').length > 300
  // importance：只在珍藏/重要时显示文字，不用彩色圆点
  const impLabel = m.importance >= 9 ? '珍藏' : m.importance >= 7 ? '重要' : null

  return (
    <div className="card">
      {/* 卡片顶部：层级圆点 + 范围 + 重要度文字 + 日期 */}
      <div className="card-header">
        <div className="card-header-left">
          {m.layer && (
            <span className="badge-layer-dot">
              <span className="layer-dot" style={{ background: LAYER_COLORS[m.layer] || '#AAA' }} />
              {LAYERS[m.layer] || m.layer}
            </span>
          )}
          {m.scope && m.scope !== 'shared' && (
            <span className="badge badge-scope">{SCOPES[m.scope] || m.scope}</span>
          )}
          {impLabel && <span className="imp-text">{impLabel}</span>}
        </div>
        <span className="card-date">{fmtDate(m.created_at)}</span>
      </div>

      {/* 正文 */}
      <div className={'card-content' + (exp ? ' expanded' : '')}>
        {m.content}
        {long && !exp && <div className="card-fade" />}
      </div>
      {long && (
        <div className="card-more" onClick={() => setExp(!exp)}>
          {exp ? '收起' : '展开全文'}
        </div>
      )}

      {/* 用户标签 */}
      {tags.length > 0 && (
        <div className="tags">
          {tags.map((t, i) => <span key={i} className="tag">{t}</span>)}
        </div>
      )}

      {/* 底部操作 */}
      <div className="card-footer">
        <span className="card-agent">{m.agent || ''}</span>
        <div className="card-acts">
          <button className="icon-btn" onClick={() => onEdit(m)}><Pencil size={14} /></button>
          <button className="icon-btn danger" onClick={() => onTrash(m)}><Trash2 size={14} /></button>
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
  const [days, setDays] = useState(null)

  // 在一起多少天
  useEffect(() => {
    api.anniversaries().then((list) => {
      const a = list.find((x) => x.anniversary_date?.startsWith('2025-10-10'))
      if (a) {
        const d = Math.floor((Date.now() - new Date(a.anniversary_date).getTime()) / 86400000) + 1
        setDays(d)
      }
    }).catch(() => {})
  }, [])

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
      {/* 顶栏 */}
      <div className="topbar">
        <div>
          <h1>拾羽</h1>
          {days != null && (
            <div className="together-line">
              <span>🐦‍⬛</span><span className="together-heart">♡</span><span>🐦</span>
              <span className="together-text">在一起 <strong>{days}</strong> 天</span>
            </div>
          )}
        </div>
        <div className="topbar-actions">
          {clock && <span className="clock"><Clock size={12} />{clock}</span>}
          <button className="btn-icon" onClick={load}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* 热力图 */}
      <Heatmap data={heat} />
      <div className="heatmap-legend">过去 12 周 · {mems.length} 条记忆</div>

      {/* 搜索框 */}
      <div className="search-wrap">
        <div className="search-box">
          <Search size={14} />
          <input value={q} placeholder="搜索记忆…" onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {/* Scope 横向 tab */}
      <div className="scope-tabs">
        <button className={'scope-tab' + (scope === '' ? ' active' : '')} onClick={() => setScope('')}>全部</button>
        {Object.entries(SCOPES).map(([v, l]) => (
          <button key={v} className={'scope-tab' + (scope === v ? ' active' : '')} onClick={() => setScope(v)}>{l}</button>
        ))}
      </div>

      {/* Layer 彩色圆点胶囊 */}
      <div className="layer-pills">
        <button className={'layer-pill' + (layer === '' ? ' active' : '')} onClick={() => setLayer('')}>全部层</button>
        {Object.entries(LAYERS).map(([v, l]) => (
          <button key={v} className={'layer-pill' + (layer === v ? ' active' : '')} onClick={() => setLayer(v)}>
            <span className="layer-dot" style={{ background: LAYER_COLORS[v] }} />
            {l}
          </button>
        ))}
      </div>

      {error && <div className="error-box">{error}</div>}
      {!error && mems.length === 0 && !loading && <div className="empty">暂无记忆</div>}

      <div className="mem-list">
        {mems.map((m) => <Card key={m.id} m={m} onEdit={setEditor} onTrash={trash} />)}
      </div>

      {/* 悬浮新建按钮 */}
      <button className="fab" onClick={() => setEditor({ _new: true })}>
        <Plus size={22} />
      </button>

      {editor && (
        <Editor
          initial={editor._new ? null : editor}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load() }}
        />
      )}
    </div>
  )
}
