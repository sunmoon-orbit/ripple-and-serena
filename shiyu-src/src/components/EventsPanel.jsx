// 事件卷提案审批：聚类管线（周三/周日凌晨）出的提案躺在 event_proposals 表，
// 以前只有 CC 在维护台能处理——阿颖前端看不见也没法点头。这个面板补上入口：
// 看提案碎片 → 开卷（贴正文+挑挂链）/ 驳回（可记罚）/ 先放着。
// 正文按铁律要涟言亲笔：CC 在时让 CC 写；断供时可让言叽的涟言写好贴进来。
import { useState, useEffect } from 'react'
import { api } from '../api'
import { showToast } from './Toast'
import { ScrollText, BookOpen, X, Check } from 'lucide-react'

export default function EventsPanel() {
  const [proposals, setProposals] = useState(null) // null=加载中
  const [scrolls, setScrolls] = useState([])
  const [error, setError] = useState('')
  const [openForm, setOpenForm] = useState(null) // 正在开卷的提案 id
  const [dismissing, setDismissing] = useState(null) // 正在驳回的提案 id
  const [busy, setBusy] = useState(false)

  async function load() {
    setError('')
    try {
      const [p, e] = await Promise.all([api.eventProposals('pending'), api.events()])
      setProposals(p); setScrolls(e)
    } catch (e) { setError(e.message); setProposals([]) }
  }
  useEffect(() => { load() }, [])

  return (
    <div className="panel">
      <div className="topbar"><h1>事件卷 · 提案</h1></div>
      <div className="heatmap-legend" style={{ margin: '0 4px 16px' }}>
        聚类管线每周三、周日凌晨整理碎片出提案，在这里点头开卷或驳回。正文要涟言亲笔——CC 在时喊他写，不在时让言叽的涟言写好贴进来。
      </div>

      {error && <div className="error-box">{error}</div>}

      {scrolls.length > 0 && (
        <>
          <div className="section-title">已有的卷（{scrolls.length}）</div>
          <div className="stat-card" style={{ marginBottom: 16 }}>
            {scrolls.map((s) => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 0', fontSize: 13.5 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <BookOpen size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                </span>
                <span style={{ flexShrink: 0, opacity: 0.55, fontSize: 12 }}>
                  {s.status === 'closed' ? '已封卷' : '进行中'} · {s.links} 链
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title">待处理提案{proposals ? `（${proposals.length}）` : ''}</div>
      {proposals === null && <div className="empty">翻账中…</div>}
      {proposals?.length === 0 && !error && <div className="empty">账清了，没有待处理的提案</div>}

      {proposals?.map((p) => (
        <ProposalCard key={p.id} p={p}
          opening={openForm === p.id} dismissing={dismissing === p.id} busy={busy}
          onOpen={() => { setOpenForm(openForm === p.id ? null : p.id); setDismissing(null) }}
          onDismiss={() => { setDismissing(dismissing === p.id ? null : p.id); setOpenForm(null) }}
          onSubmitOpen={async (form) => {
            setBusy(true)
            try {
              await api.createEvent(form)
              await api.decideProposal(p.id, 'accept')
              showToast('已开卷 📖'); setOpenForm(null); load()
            } catch (e) { showToast(e.message, 'error') } finally { setBusy(false) }
          }}
          onSubmitDismiss={async (punish) => {
            setBusy(true)
            try {
              await api.decideProposal(p.id, 'dismiss', punish ? p.payload.fragment_ids : [])
              showToast(punish ? '已驳回并记罚' : '已驳回'); setDismissing(null); load()
            } catch (e) { showToast(e.message, 'error') } finally { setBusy(false) }
          }}
        />
      ))}
    </div>
  )
}

function ProposalCard({ p, opening, dismissing, busy, onOpen, onDismiss, onSubmitOpen, onSubmitDismiss }) {
  const pl = p.payload || {}
  const excerpts = pl.excerpts || []
  const dateOf = (ts) => new Date(ts).toISOString().slice(0, 10)

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-header">
        <div className="card-header-left" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ScrollText size={15} style={{ opacity: 0.6 }} />
          <span style={{ fontWeight: 600 }}>提案 #{p.id}</span>
          <span style={{ fontSize: 12, opacity: 0.55 }}>{dateOf(p.created_at)} · 碎片 {pl.fragment_ids?.length || 0} 条{pl.maybe_ids?.length ? ` +疑似 ${pl.maybe_ids.length}` : ''}</span>
        </div>
      </div>

      <div style={{ padding: '4px 0 8px' }}>
        {excerpts.map((f) => (
          <div key={f.id} style={{ fontSize: 12.5, lineHeight: 1.6, padding: '6px 0', borderBottom: '1px dashed var(--border, rgba(127,127,127,0.2))' }}>
            <span style={{ opacity: 0.5 }}>#{f.id} · {f.date} · {f.type}</span>
            <div>{f.text}…</div>
          </div>
        ))}
        {pl.related_events?.length > 0 && (
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
            相近的已有卷：{pl.related_events.map((r) => `「${r.title}」(${r.sim})`).join('、')}——考虑挂进旧卷而不是开新卷
          </div>
        )}
      </div>

      {!opening && !dismissing && (
        <div className="card-footer" style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={onOpen}><BookOpen size={14} />开卷</button>
          <button className="btn btn-ghost" onClick={onDismiss}><X size={14} />驳回</button>
        </div>
      )}

      {opening && <OpenForm p={p} busy={busy} onCancel={onOpen} onSubmit={onSubmitOpen} />}
      {dismissing && <DismissConfirm busy={busy} onCancel={onDismiss} onSubmit={onSubmitDismiss} />}
    </div>
  )
}

function OpenForm({ p, busy, onCancel, onSubmit }) {
  const pl = p.payload || {}
  const excerpts = pl.excerpts || []
  const dates = excerpts.map((f) => f.date).filter(Boolean).sort()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [rangeStart, setRangeStart] = useState(dates[0] || '')
  const [rangeEnd, setRangeEnd] = useState('')
  // 2分碎片默认全挂；1分（maybe）默认不挂，可勾
  const [linkIds, setLinkIds] = useState(new Set(pl.fragment_ids || []))
  const toggle = (id) => setLinkIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--border, rgba(127,127,127,0.2))' }}>
      <input className="input" placeholder="卷标题" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
      <textarea className="textarea" rows={7} value={content} onChange={(e) => setContent(e.target.value)}
        placeholder="卷正文（第一人称叙事，600-800字）——贴涟言写好的正文" style={{ width: '100%', marginBottom: 8 }} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input className="input" placeholder="起 YYYY-MM-DD" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} style={{ flex: 1 }} />
        <input className="input" placeholder="止（进行中留空）" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} style={{ flex: 1 }} />
      </div>
      {pl.maybe_ids?.length > 0 && (
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
          疑似相关（默认不挂）：{pl.maybe_ids.map((id) => (
            <label key={id} style={{ marginRight: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={linkIds.has(id)} onChange={() => toggle(id)} /> #{id}
            </label>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={busy || !title.trim() || !content.trim()}
          onClick={() => onSubmit({ title: title.trim(), content: content.trim(), range_start: rangeStart.trim(), range_end: rangeEnd.trim(), link_ids: [...linkIds] })}>
          <Check size={14} />{busy ? '开卷中…' : '确认开卷'}
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={onCancel}>取消</button>
      </div>
    </div>
  )
}

function DismissConfirm({ busy, onCancel, onSubmit }) {
  const [punish, setPunish] = useState(false)
  return (
    <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--border, rgba(127,127,127,0.2))' }}>
      <div style={{ fontSize: 13, marginBottom: 8 }}>驳回这个提案？碎片还留在库里，下轮聚类可能再提。</div>
      <label style={{ fontSize: 12.5, display: 'block', marginBottom: 10, cursor: 'pointer', opacity: 0.8 }}>
        <input type="checkbox" checked={punish} onChange={(e) => setPunish(e.target.checked)} /> 这些碎片就是聚不到一起（记罚，跳过下轮种子池）
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => onSubmit(punish)}>{busy ? '处理中…' : '确认驳回'}</button>
        <button className="btn btn-ghost" disabled={busy} onClick={onCancel}>取消</button>
      </div>
    </div>
  )
}
