import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { showToast } from './Toast'
import { Plus, RefreshCw, Search, Clock, Pencil, Trash2, Share2, Sparkles, ArrowUpDown } from 'lucide-react'

export const SCOPES = { shared: '共享', private_阿颖: '阿颖私密', private_阿言: '阿言私密' }
export const LAYERS = { core: '核心', long: '长期', short: '短期', consciousness: '意识' }
const LAYER_COLORS = { core: '#D4807A', long: '#D4A070', short: '#C4B070', consciousness: '#A080C0' }
const META = new Set(['core', 'long', 'short', 'consciousness', 'shared', 'private_阿颖', 'private_阿言', '阿言', '阿颖'])

// 横向 tab：label → { scope?, type? }
const TABS = [
  { l: '全部',    scope: '',            type: '' },
  { l: '共享',    scope: 'shared',      type: '' },
  { l: '技术',    scope: '',            type: 'tech' },
  { l: '交接信',  scope: '',            type: 'handoff' },
  { l: '窗口',    scope: '',            type: 'window' },
  { l: '书单',    scope: '',            type: 'book' },
  { l: '日记',    scope: '',            type: 'diary' },
  { l: '阿颖私密', scope: 'private_阿颖', type: '' },
  { l: '阿言私密', scope: 'private_阿言', type: '' },
]

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

function Heatmap({ data, selectedDate, onSelectDate, offset = 0 }) {
  const days = []
  for (let i = 83 + offset; i >= offset; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    days.push({ key: d.toISOString().slice(0, 10), n: data[d.toISOString().slice(0, 10)] || 0 })
  }
  return (
    <div className="heatmap-wrap">
      <div className="heatmap">
        {days.map((d) => {
          const op = d.n ? Math.min(0.25 + (d.n / 6) * 0.75, 1) : 0
          const selected = selectedDate === d.key
          return <div key={d.key} className={'heatmap-cell' + (selected ? ' selected' : '')}
            title={`${d.key}: ${d.n} 条`}
            onClick={() => d.n && onSelectDate(selected ? null : d.key)}
            style={{
              ...(op ? { background: 'var(--olive-active)', opacity: op } : {}),
              ...(selected ? { outline: '2px solid var(--olive-active)', opacity: 1, background: 'var(--olive-active)' } : {}),
              cursor: d.n ? 'pointer' : 'default',
            }} />
        })}
      </div>
    </div>
  )
}

function EmotionHeatmap({ data, selectedDate, onSelectDate, offset = 0 }) {
  const days = []
  for (let i = 83 + offset; i >= offset; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    days.push({ key, ...(data[key] || null) })
  }

  function cellColor(d) {
    if (!d.valence && d.valence !== 0) return undefined
    const v = d.valence  // -1 ~ 1
    const a = d.arousal ?? 0.5  // 0 ~ 1
    const alpha = 0.2 + a * 0.8
    if (v > 0.2) {
      // 暖色：橙红
      const r = Math.round(200 + v * 55)
      const g = Math.round(120 - v * 60)
      return `rgba(${r},${g},60,${alpha.toFixed(2)})`
    } else if (v < -0.2) {
      // 冷色：蓝紫
      const b = Math.round(180 + Math.abs(v) * 60)
      const r = Math.round(80 - Math.abs(v) * 40)
      return `rgba(${r},100,${b},${alpha.toFixed(2)})`
    } else {
      // 中性：灰
      return `rgba(150,150,150,${(0.15 + a * 0.3).toFixed(2)})`
    }
  }

  return (
    <div className="heatmap-wrap">
      <div className="heatmap">
        {days.map((d) => {
          const bg = cellColor(d)
          return <div key={d.key} className="heatmap-cell"
            title={d.n ? `${d.key}: 情绪${d.valence >= 0 ? '+' : ''}${d.valence?.toFixed(2)} 强度${d.arousal?.toFixed(2)}` : d.key}
            onClick={() => d.n && onSelectDate(selectedDate === d.key ? null : d.key)}
            style={{
              ...(bg ? { background: bg } : {}),
              ...(selectedDate === d.key ? { outline: '2px solid var(--accent)', borderRadius: 3 } : {}),
              cursor: d.n ? 'pointer' : 'default',
            }} />
        })}
      </div>
    </div>
  )
}

const MEM_TYPES = [
  { v: 'memory',  l: '普通' },
  { v: 'tech',    l: '技术' },
  { v: 'diary',   l: '日记' },
  { v: 'handoff', l: '交接信' },
  { v: 'window',  l: '窗口' },
  { v: 'book',    l: '书单' },
]

function Editor({ initial, onClose, onSaved }) {
  const isEdit = !!initial?.id
  const [content, setContent] = useState(initial?.content || '')
  const [tags, setTags] = useState(initial?.tags || '')
  const [scope, setScope] = useState(initial?.scope || 'shared')
  const [layer, setLayer] = useState(initial?.layer || '')
  const [memType, setMemType] = useState(initial?.type || 'memory')
  const [importance, setImportance] = useState(initial?.importance || 5)
  const [memorable, setMemorable] = useState((initial?.arousal || 0) > 0.6)
  const [agent, setAgent] = useState(initial?.agent || (initial?.type === 'diary' ? '阿颖' : '阿言'))
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!content.trim()) return showToast('内容不能为空', 'error')
    setSaving(true)
    const fields = { content: content.trim(), tags, scope, layer: layer || null, type: memType, importance, arousal: memorable ? 0.85 : 0.3 }
    try {
      if (isEdit) await api.update(initial.id, { ...fields, agent })
      else await api.create({ ...fields, owner: '阿颖', agent })
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
          <select className="select" style={{ flex: 1 }} value={memType} onChange={(e) => {
            const t = e.target.value
            setMemType(t)
            if (!initial?.id) setAgent(t === 'diary' ? '阿颖' : '阿言')
          }}>
            {MEM_TYPES.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <select className="select" style={{ flex: 1 }} value={layer} onChange={(e) => setLayer(e.target.value)}>
            <option value="">无层级</option>
            {Object.entries(LAYERS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="select" style={{ flex: 1 }} value={importance}
            onChange={(e) => setImportance(Number(e.target.value))}>
            {IMP_OPTS.map((o) => <option key={o.v} value={o.v}>重要程度：{o.l}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <select className="select" style={{ flex: 1 }} value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="阿颖">阿颖写的</option>
            <option value="阿言">阿言写的</option>
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

function emotionColor(valence) {
  if (valence == null || valence === 0) return null
  if (valence > 0.3) return `rgba(220,100,60,${Math.min(0.3 + valence * 0.6, 0.9).toFixed(2)})`
  if (valence < -0.3) return `rgba(80,120,200,${Math.min(0.3 + Math.abs(valence) * 0.6, 0.9).toFixed(2)})`
  return null
}

function Card({ m, onEdit, onTrash }) {
  const [exp, setExp] = useState(false)
  const [relOpen, setRelOpen] = useState(false)
  const [related, setRelated] = useState(null)
  const [relLoading, setRelLoading] = useState(false)
  const tags = (m.tags || '').split(',').map((t) => t.trim()).filter((t) => t && !META.has(t))
  const long = (m.content || '').length > 300
  const impLabel = m.importance >= 9 ? '珍藏' : m.importance >= 7 ? '重要' : null

  async function toggleRelated() {
    if (relOpen) { setRelOpen(false); return }
    setRelOpen(true)
    if (related !== null) return
    setRelLoading(true)
    try {
      const list = await api.related(m.id)
      setRelated(list)
    } catch { setRelated([]) } finally { setRelLoading(false) }
  }

  return (
    <div className="card" style={{ '--layer-c': LAYER_COLORS[m.layer] || 'transparent' }}>
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
          {m.resolved ? <span className="badge badge-resolved">已了结</span> : null}
          {emotionColor(m.valence) && (
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: emotionColor(m.valence), display: 'inline-block', flexShrink: 0 }} title={`情绪 ${m.valence > 0 ? '+' : ''}${m.valence?.toFixed(2)}`} />
          )}
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
          <button
            className={'icon-btn related-btn' + (relOpen ? ' active' : '')}
            onClick={toggleRelated}
            title="关联记忆"
          >
            <Share2 size={13} />
            <span>相关</span>
          </button>
          <button className="icon-btn" onClick={() => onEdit(m)}><Pencil size={14} /></button>
          <button className="icon-btn danger" onClick={() => onTrash(m)}><Trash2 size={14} /></button>
        </div>
      </div>

      {/* 关联记忆展开区 */}
      {relOpen && (
        <div className="related-section">
          {relLoading && <div className="related-loading">加载中…</div>}
          {!relLoading && related !== null && related.length === 0 && (
            <div className="related-empty">暂无关联记忆</div>
          )}
          {!relLoading && related && related.map((r) => (
            <div key={r.id} className="related-item">
              <div className="related-item-content">
                {(r.content || '').slice(0, 100)}{(r.content || '').length > 100 ? '…' : ''}
              </div>
              <div className="related-item-meta">
                {r.layer && <span className="layer-dot" style={{ background: LAYER_COLORS[r.layer] || '#AAA', display: 'inline-block' }} />}
                <span className="related-item-date">{fmtDate(r.created_at)}</span>
                {r.similarity != null && (
                  <span className="related-item-score">{Math.round(r.similarity * 100)}%</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function MemoryPanel() {
  const clock = useClock()
  const [mems, setMems] = useState([])
  const [heat, setHeat] = useState({})
  const [emotionHeat, setEmotionHeat] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [scope, setScope] = useState('')
  const [memType, setMemType] = useState('')
  const [layer, setLayer] = useState('')
  const [editor, setEditor] = useState(null)
  const [days, setDays] = useState(null)
  const [tabIdx, setTabIdx] = useState(0)
  const [selectedDate, setSelectedDate] = useState(null)
  const [sortBy, setSortBy] = useState('date') // date | importance | arousal
  const [sortDir, setSortDir] = useState('desc') // desc | asc
  const [semanticLoading, setSemanticLoading] = useState(false)
  const [heatType, setHeatType] = useState('count') // count | emotion
  const [heatPage, setHeatPage] = useState(0) // 0=最近12周, 1=再往前12周...

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
      const params = { q, limit: 200 }
      if (scope) params.scope = scope
      if (memType) params.type = memType
      if (layer) params.layer = layer
      if (selectedDate) params.date = selectedDate
      const heatOffset = heatPage * 84
      const [m, h, eh] = await Promise.all([api.list(params), api.heatmap({ offset: heatOffset }), api.emotionHeatmap({ offset: heatOffset })])
      setMems(m); setHeat(h); setEmotionHeat(eh)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [q, scope, memType, layer, selectedDate, heatPage])

  useEffect(() => { load() }, [load])

  const sortedMems = [...mems].sort((a, b) => {
    let diff = 0
    if (sortBy === 'importance') diff = (b.importance || 5) - (a.importance || 5)
    else if (sortBy === 'arousal') diff = (b.arousal || 0) - (a.arousal || 0)
    else diff = new Date(b.created_at) - new Date(a.created_at) // date: 默认新→旧
    return sortDir === 'desc' ? diff : -diff
  })

  async function semanticSearch() {
    if (!q.trim()) return showToast('请先输入搜索词', 'error')
    setSemanticLoading(true)
    try {
      const results = await api.semantic(q.trim())
      setMems(results)
      showToast(`语义搜索找到 ${results.length} 条`, 'success')
    } catch (e) { showToast(e.message, 'error') }
    finally { setSemanticLoading(false) }
  }

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
          <h1 className="plume-title">Plume</h1>
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

      {/* 热力图切换 + 翻页 */}
      <div className="heatmap-nav">
        <div className="heatmap-switch">
          <button className={'heatmap-switch-btn' + (heatType === 'count' ? ' active' : '')} onClick={() => setHeatType('count')}>记忆数</button>
          <button className={'heatmap-switch-btn' + (heatType === 'emotion' ? ' active' : '')} onClick={() => setHeatType('emotion')}>情绪</button>
        </div>
        <div className="heatmap-pager">
          <button className="heatmap-pager-btn" onClick={() => setHeatPage(p => p + 1)} title="往前">←</button>
          <span className="heatmap-pager-label">{heatPage === 0 ? '最近 12 周' : `第 ${heatPage + 1} 期`}</span>
          <button className="heatmap-pager-btn" onClick={() => setHeatPage(p => Math.max(0, p - 1))} disabled={heatPage === 0} title="往后">→</button>
        </div>
      </div>
      {heatType === 'count' ? (
        <>
          <Heatmap data={heat} selectedDate={selectedDate} onSelectDate={setSelectedDate} offset={heatPage * 84} />
          <div className="heatmap-legend">
            {selectedDate
              ? <><span style={{ color: 'var(--olive-active)', fontWeight: 600 }}>{selectedDate}</span> · {mems.length} 条 <button className="card-more" style={{ display: 'inline', marginLeft: 6 }} onClick={() => setSelectedDate(null)}>取消筛选</button></>
              : <>过去 12 周 · {mems.length} 条记忆</>
            }
          </div>
        </>
      ) : (
        <>
          <EmotionHeatmap data={emotionHeat} selectedDate={selectedDate} onSelectDate={setSelectedDate} offset={heatPage * 84} />
          <div className="heatmap-legend">情绪分布 · 暖色积极 冷色消极 深色强烈</div>
        </>
      )}

      {/* 搜索框 */}
      <div className="search-wrap">
        <div className="search-box">
          <Search size={14} />
          <input value={q} placeholder="搜索记忆…" onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()} />
          <button className="icon-btn" style={{ width: 26, height: 26, flexShrink: 0 }}
            onClick={semanticSearch} disabled={semanticLoading} title="语义搜索">
            <Sparkles size={13} className={semanticLoading ? 'spin' : ''} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
          <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            style={{ background:'none', border:'none', cursor:'pointer', padding:'2px 4px', color:'var(--ink-faint)', display:'flex', alignItems:'center' }}
            title={sortDir === 'desc' ? '当前：新→旧，点击反转' : '当前：旧→新，点击反转'}>
            {sortDir === 'desc' ? <ArrowUpDown size={12} /> : <ArrowUpDown size={12} style={{ transform:'scaleY(-1)' }} />}
          </button>
          {[['date','时间'],['importance','重要性'],['arousal','情绪强度']].map(([v,l]) => (
            <button key={v} className={'scope-tab' + (sortBy === v ? ' active' : '')}
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => setSortBy(v)}>{l}</button>
          ))}
        </div>
      </div>

      {/* 横向 tab：scope + type 组合筛选 */}
      <div className="scope-tabs">
        {TABS.map((t, i) => (
          <button key={i}
            className={'scope-tab' + (tabIdx === i ? ' active' : '')}
            onClick={() => { setTabIdx(i); setScope(t.scope); setMemType(t.type) }}>
            {t.l}
          </button>
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
        {sortedMems.map((m) => <Card key={m.id} m={m} onEdit={setEditor} onTrash={trash} />)}
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
