import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../../store'
import { fetchMemories, createMemory, updateMemory, trashMemory, fetchHeatmap } from '../../api/moonMemory'
import { showToast } from '../Toast'
import { formatTime } from '../../utils'

const SCOPE_LABELS = { shared: '共享', private_qing: '私密', private_crow: '乌鸦' }
const LAYER_LABELS = { core: '核心', long: '长期', short: '短期' }
const LAYER_COLORS = { core: 'layer-core', long: 'layer-long', short: 'layer-short' }

function HeatmapCell({ count, date }) {
  const intensity = count ? Math.min(0.2 + (count / 5) * 0.8, 1) : 0
  return (
    <div
      className="heatmap-cell"
      title={`${date}: ${count || 0} 条`}
      style={{ opacity: intensity || undefined, backgroundColor: count ? undefined : 'var(--border-md)' }}
    />
  )
}

export default function Memory() {
  const moonMemory = useStore((s) => s.moonMemory)
  const [memories, setMemories] = useState([])
  const [heatmap, setHeatmap] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [filterScope, setFilterScope] = useState('')
  const [filterLayer, setFilterLayer] = useState('')
  const [creating, setCreating] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [newTags, setNewTags] = useState('')
  const [newScope, setNewScope] = useState('shared')
  const [newLayer, setNewLayer] = useState('')
  const [editId, setEditId] = useState(null)
  const [editContent, setEditContent] = useState('')
  const [editTags, setEditTags] = useState('')

  const cfg = moonMemory

  const load = useCallback(async () => {
    if (!cfg?.apiToken) return
    setLoading(true)
    setError('')
    try {
      const [mems, hm] = await Promise.all([
        fetchMemories(cfg, { q: searchQ, scope: filterScope, layer: filterLayer, limit: 100 }),
        fetchHeatmap(cfg),
      ])
      setMemories(mems)
      setHeatmap(hm)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [cfg, searchQ, filterScope, filterLayer])

  useEffect(() => { load() }, [load])

  async function handleCreate() {
    if (!newContent.trim()) return
    try {
      await createMemory(cfg, { content: newContent.trim(), tags: newTags.trim(), scope: newScope, layer: newLayer || null, agent: 'crow', owner: 'qing' })
      setNewContent(''); setNewTags(''); setCreating(false)
      showToast('记忆已创建', 'success')
      load()
    } catch (e) { showToast(e.message, 'error') }
  }

  async function handleUpdate(id) {
    try {
      await updateMemory(cfg, id, { content: editContent, tags: editTags })
      setEditId(null)
      showToast('已更新', 'success')
      load()
    } catch (e) { showToast(e.message, 'error') }
  }

  async function handleTrash(id) {
    if (!confirm('将此记忆移入回收站？')) return
    try {
      await trashMemory(cfg, id)
      showToast('已移入回收站', 'info')
      load()
    } catch (e) { showToast(e.message, 'error') }
  }

  // Heatmap: last 84 days (12 weeks)
  const heatmapDays = []
  for (let i = 83; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    heatmapDays.push({ key, count: heatmap[key] || 0 })
  }

  if (!cfg?.apiToken) {
    return (
      <div className="panel-shell">
        <div className="panel-empty">
          <p>请在<button className="link-btn" onClick={() => useStore.getState().setActivePanel('settings')}>设置</button>中配置拾羽记忆库的 API Token</p>
        </div>
      </div>
    )
  }

  return (
    <div className="panel-shell memory-panel">
      <div className="panel-topbar">
        <h2 className="panel-title">拾羽记忆库</h2>
        <div className="panel-topbar-actions">
          <button className="btn-sm btn-primary" onClick={() => setCreating(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新记忆
          </button>
          <button className="btn-sm btn-ghost" onClick={load} disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ animation: loading ? 'spin 1s linear infinite' : undefined }}>
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Heatmap */}
      <div className="memory-heatmap-wrap">
        <div className="memory-heatmap">
          {heatmapDays.map((d) => <HeatmapCell key={d.key} count={d.count} date={d.key} />)}
        </div>
        <div className="heatmap-legend">过去 12 周 · {memories.length} 条记忆</div>
      </div>

      {/* Filters */}
      <div className="memory-filters">
        <div className="filter-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input className="filter-input" placeholder="搜索记忆..." value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
        </div>
        <select className="filter-select" value={filterScope} onChange={(e) => setFilterScope(e.target.value)}>
          <option value="">全部范围</option>
          {Object.entries(SCOPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="filter-select" value={filterLayer} onChange={(e) => setFilterLayer(e.target.value)}>
          <option value="">全部层</option>
          {Object.entries(LAYER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {/* Create form */}
      {creating && (
        <div className="memory-create-card">
          <textarea
            className="memory-create-textarea"
            placeholder="记忆内容..."
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            rows={3}
            autoFocus
          />
          <div className="memory-create-meta">
            <input className="memory-create-tags" placeholder="标签（逗号分隔）" value={newTags} onChange={(e) => setNewTags(e.target.value)} />
            <select className="filter-select" value={newScope} onChange={(e) => setNewScope(e.target.value)}>
              {Object.entries(SCOPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select className="filter-select" value={newLayer} onChange={(e) => setNewLayer(e.target.value)}>
              <option value="">无层级</option>
              {Object.entries(LAYER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="memory-create-actions">
            <button className="btn-sm btn-ghost" onClick={() => setCreating(false)}>取消</button>
            <button className="btn-sm btn-primary" onClick={handleCreate}>保存</button>
          </div>
        </div>
      )}

      {error && <div className="memory-error">{error}</div>}

      {/* Memory list */}
      <div className="memory-list">
        {memories.length === 0 && !loading && (
          <div className="panel-empty">暂无记忆</div>
        )}
        {memories.map((m) => (
          <div key={m.id} className="memory-card">
            {editId === m.id ? (
              <div className="memory-edit">
                <textarea className="memory-edit-textarea" value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={3} autoFocus />
                <input className="memory-edit-tags" placeholder="标签" value={editTags} onChange={(e) => setEditTags(e.target.value)} />
                <div className="memory-edit-actions">
                  <button className="btn-sm btn-ghost" onClick={() => setEditId(null)}>取消</button>
                  <button className="btn-sm btn-primary" onClick={() => handleUpdate(m.id)}>保存</button>
                </div>
              </div>
            ) : (
              <>
                <div className="memory-card-body">
                  <p className="memory-content">{m.content}</p>
                  {m.tags && <div className="memory-tags">{m.tags.split(',').filter(Boolean).map((t, i) => <span key={i} className="memory-tag">{t.trim()}</span>)}</div>}
                </div>
                <div className="memory-card-footer">
                  <div className="memory-badges">
                    <span className={`layer-badge ${LAYER_COLORS[m.layer] || ''}`}>{LAYER_LABELS[m.layer] || m.layer || '—'}</span>
                    <span className="scope-badge">{SCOPE_LABELS[m.scope] || m.scope}</span>
                    {m.agent && m.agent !== 'shared' && <span className="agent-badge">{m.agent}</span>}
                  </div>
                  <div className="memory-card-meta">
                    <span className="memory-date">{formatTime(m.created_at)}</span>
                    <div className="memory-card-actions">
                      <button className="mem-action-btn" title="编辑" onClick={() => { setEditId(m.id); setEditContent(m.content); setEditTags(m.tags || '') }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button className="mem-action-btn danger" title="移入回收站" onClick={() => handleTrash(m.id)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
