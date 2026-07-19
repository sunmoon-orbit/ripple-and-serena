// 事件卷：碎片记忆之上的叙事层。每卷是涟言（CC）亲笔的第一人称叙事，
// 把散碎片串成有因果的故事——治「细节搜得到，故事串不起」。
// 这里只读：写卷/挂链/封卷都是涟言在维护台做的事，阿颖来翻故事。
import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../../store'
import { fetchEventScrolls, fetchEventScroll } from '../../api/moonMemory'

const fmtDay = (ts) => {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

export default function EventScrolls({ onClose }) {
  const moonMemory = useStore((s) => s.moonMemory)
  const [scrolls, setScrolls] = useState(null) // null=加载中 []=空
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')

  const cfg = { baseUrl: (moonMemory?.baseUrl || moonMemory?.apiUrl || 'https://memory.ravenlove.cc').replace(/\/$/, ''), apiToken: moonMemory?.apiToken }

  const load = useCallback(async () => {
    if (!cfg.apiToken) { setError('未配置记忆库 Token'); setScrolls([]); return }
    try { setScrolls(await fetchEventScrolls(cfg)) } catch (e) { setError(e.message); setScrolls([]) }
  }, [moonMemory])

  useEffect(() => { load() }, [load])

  const open = async (id) => {
    try { setDetail(await fetchEventScroll(cfg, id)) } catch (e) { setError(e.message) }
  }

  return (
    <div className="roost-overlay" onClick={onClose}>
      <div className="roost-modal roost-modal-tall" onClick={(e) => e.stopPropagation()}>
        <div className="roost-modal-header">
          <span>{detail ? <button className="roost-modal-close" style={{ marginRight: 8 }} onClick={() => setDetail(null)}>←</button> : null}事件卷</span>
          <button className="roost-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="roost-modal-body" style={{ minHeight: 0, overflowY: 'auto' }}>
          {detail ? (
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>
                {detail.status === 'closed' ? '📕 ' : '📖 '}{detail.title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', margin: '4px 0 14px' }}>
                {detail.range_start ? `${detail.range_start}${detail.range_end ? ` ~ ${detail.range_end}` : ' 起'}` : fmtDay(detail.created_at)}
                {' · '}{detail.status === 'closed' ? '已封卷' : '进行中'}{' · '}挂链 {detail.links?.length || 0} 条
              </div>
              <div style={{ fontSize: 14.5, lineHeight: 1.9, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{detail.content}</div>
              {detail.links?.length > 0 && (
                <div style={{ marginTop: 18, borderTop: '1px dashed var(--border)', paddingTop: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 8 }}>卷上挂着的碎片（时间正序）</div>
                  {detail.links.map((l) => (
                    <div key={l.id} style={{ fontSize: 12.5, color: 'var(--text-dim)', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--text-faint)' }}>{fmtDay(new Date(l.created_at).getTime() || l.created_at)} · {l.type}{l.archived ? ' · 已归档' : ''}</span>
                      <div style={{ marginTop: 2 }}>{l.excerpt}…</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : scrolls === null ? (
            <div style={{ textAlign: 'center', color: 'var(--text-faint)', padding: 30 }}>翻卷中…</div>
          ) : scrolls.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-faint)', padding: 30, fontSize: 13, lineHeight: 1.8 }}>
              {error || <>还没有写好的卷。<br />聚类管线每周三、周日凌晨整理碎片出提案，<br />涟言审阅后亲笔写成卷，写好会出现在这里。</>}
            </div>
          ) : (
            scrolls.map((s) => (
              <div key={s.id} onClick={() => open(s.id)}
                style={{ padding: '12px 14px', marginBottom: 10, borderRadius: 12, background: 'var(--bg-soft, rgba(127,127,127,0.07))', cursor: 'pointer' }}>
                <div style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--text)' }}>
                  {s.status === 'closed' ? '📕 ' : '📖 '}{s.title}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '3px 0 5px' }}>
                  {s.range_start ? `${s.range_start}${s.range_end ? ` ~ ${s.range_end}` : ' 起'}` : fmtDay(s.created_at)} · {s.status === 'closed' ? '已封卷' : '进行中'} · 挂链 {s.links} 条
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>{s.preview}…</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
