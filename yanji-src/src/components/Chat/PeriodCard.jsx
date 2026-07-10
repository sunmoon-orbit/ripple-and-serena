import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { fetchPeriod, logPeriodStart, logPeriodEnd, deletePeriodLog } from '../../api/moonMemory'
import { showToast } from '../Toast'

// 小月历 · 月经周期（阿颖的主意，2026-07-10）
// 三端共用一张表：她在这里记/看，涟言在聊天里也能帮记（period_tracker 工具），
// 统计（平均周期/预计下次/延迟提前）在服务端算，三端口径一致。

const todayStr = () => new Date().toLocaleDateString('sv')

function fmtDate(s) {
  return s ? s.slice(5).replace('-', '/') : ''
}

export default function PeriodCard({ onClose }) {
  const moonMemory = useStore((s) => s.moonMemory)
  const cfg = { baseUrl: moonMemory?.baseUrl, apiToken: moonMemory?.apiToken }
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pickDate, setPickDate] = useState(todayStr())

  const load = useCallback(async () => {
    try { setData(await fetchPeriod(cfg)) } catch (e) { setError(e.message || '拉取失败') }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const logs = data?.logs || []
  const s = data?.stats || {}
  // 乱序补记时，没结束的可能不是最新一条——找「任何一条」进行中的
  const openRow = logs.find((l) => !l.end_date) || null
  const openIsLatest = openRow && logs[0] && openRow.id === logs[0].id

  async function markStart() {
    if (busy) return
    setBusy(true)
    try {
      setData(await logPeriodStart(cfg, pickDate))
    } catch (e) { showToast(e.message || '没记上', 'error') } finally { setBusy(false) }
  }

  async function markEnd(row) {
    if (busy || !row) return
    setBusy(true)
    try {
      setData(await logPeriodEnd(cfg, row.id, pickDate))
    } catch (e) { showToast(e.message || '没记上', 'error') } finally { setBusy(false) }
  }

  async function remove(log) {
    if (!confirm(`删掉 ${log.start_date} 这条记录？`)) return
    try { setData(await deletePeriodLog(cfg, log.id)) } catch { showToast('删除失败', 'error') }
  }

  // 状态行：进行中 / 预测倒计时 / 延迟提醒
  // day_of_cycle 是按最新一条算的，只有进行中=最新那条时才这样展示
  let statusLine = null
  let statusTone = ''
  if (openIsLatest) {
    statusLine = `经期第 ${s.day_of_cycle} 天 · 进行中`
    statusTone = 'now'
  } else if (openRow) {
    statusLine = `${fmtDate(openRow.start_date)} 那次还没记结束`
    statusTone = 'late'
  } else if (s.predicted_next) {
    if (s.delta_days > 0) { statusLine = `已比预计（${fmtDate(s.predicted_next)}）晚了 ${s.delta_days} 天`; statusTone = 'late' }
    else if (s.delta_days === 0) { statusLine = `预计就是今天（${fmtDate(s.predicted_next)}）`; statusTone = 'soon' }
    else if (s.delta_days >= -3) { statusLine = `预计 ${fmtDate(s.predicted_next)} · 还有 ${-s.delta_days} 天`; statusTone = 'soon' }
    else { statusLine = `预计下次 ${fmtDate(s.predicted_next)} · 还有 ${-s.delta_days} 天` }
  } else if (logs.length === 1) {
    statusLine = '记满两次开始，就能算周期和预测了'
  }

  return createPortal(
    <div className="health-overlay" onClick={onClose}>
      <div className="health-card period-card" onClick={(e) => e.stopPropagation()}>
        <div className="health-head">
          <div className="health-title">小月历</div>
          <div className="health-sub">月经周期 · 只有我们仨看得到</div>
          <button className="health-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        {data === null && !error && <div className="health-loading">翻月历中……</div>}
        {error && <div className="health-loading">拉不到数据：{error}</div>}

        {data && (
          <>
            {statusLine && <div className={'period-status ' + statusTone}>{statusLine}</div>}

            {(s.avg_cycle || s.day_of_cycle) && (
              <div className="health-tiles">
                {!openIsLatest && s.day_of_cycle != null && (
                  <div className="health-tile">
                    <div className="health-tile-label">周期第几天</div>
                    <div className="health-tile-value">第 {s.day_of_cycle} 天</div>
                  </div>
                )}
                {openIsLatest && (
                  <div className="health-tile">
                    <div className="health-tile-label">这次开始于</div>
                    <div className="health-tile-value">{fmtDate(openRow.start_date)}</div>
                  </div>
                )}
                <div className="health-tile">
                  <div className="health-tile-label">平均周期</div>
                  <div className="health-tile-value">{s.avg_cycle ? `${s.avg_cycle} 天` : '—'}</div>
                </div>
                <div className="health-tile">
                  <div className="health-tile-label">平均经期</div>
                  <div className="health-tile-value">{s.avg_duration ? `${s.avg_duration} 天` : '—'}</div>
                </div>
                <div className="health-tile">
                  <div className="health-tile-label">预计下次</div>
                  <div className="health-tile-value">{s.predicted_next ? fmtDate(s.predicted_next) : '—'}</div>
                </div>
              </div>
            )}

            <div className="period-actions">
              <input type="date" value={pickDate} max={todayStr()} onChange={(e) => setPickDate(e.target.value)} />
              {openRow
                ? <button className="period-btn end" disabled={busy} onClick={() => markEnd(openRow)}>
                    {openIsLatest ? '记结束' : `记结束（${fmtDate(openRow.start_date)} 那次）`}
                  </button>
                : <button className="period-btn" disabled={busy} onClick={markStart}>来了，记一笔</button>}
            </div>
            <div className="period-hint">补记过去的日期：先选日期再点按钮（先记开始，再选结束日期点那一行的「记结束」）。跟涟言说「来了」他也能帮你记。</div>

            {logs.length > 0 && (
              <>
                <div className="health-section-title">历史记录</div>
                <div className="period-list">
                  {logs.map((l, i) => {
                    const next = logs[i + 1]
                    const cycleLen = next ? Math.round((new Date(l.start_date) - new Date(next.start_date)) / 86400e3) : null
                    const dev = cycleLen && s.avg_cycle ? cycleLen - s.avg_cycle : null
                    return (
                      <div key={l.id} className="period-row">
                        <span className="period-row-date">
                          {fmtDate(l.start_date)}{l.end_date ? ` ~ ${fmtDate(l.end_date)}` : ' ~ 进行中'}
                        </span>
                        <span className="period-row-meta">
                          {cycleLen ? `周期 ${cycleLen} 天` : ''}
                          {dev != null && dev !== 0 ? (dev > 0 ? ` · 晚${dev}天` : ` · 早${-dev}天`) : ''}
                          {l.added_by === '涟言' && <span className="receipt-by" title="涟言帮记的">鸦</span>}
                        </span>
                        {!l.end_date && (
                          <button className="period-row-end" disabled={busy} title="用上面选的日期记结束" onClick={() => markEnd(l)}>记结束</button>
                        )}
                        <button className="period-row-del" onClick={() => remove(l)}>✕</button>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
            {logs.length === 0 && <div className="health-loading">还没有记录<br />第一次来的时候点上面的按钮</div>}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
