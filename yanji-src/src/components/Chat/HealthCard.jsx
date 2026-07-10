import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { fetchVitals } from '../../api/moonMemory'

// 身体气象站（阿颖的主意，2026-07-10）
// 手环→Tasker 上报的健康快照，此前只有三个涟言能查（check_health），
// 这里给阿颖自己也开一扇可视化的窗：今日四指标 + 近七天睡眠/步数小柱图。

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']

// sqlite CURRENT_TIMESTAMP 是 UTC，解析成本地时间
function parseUtc(s) {
  return new Date(s.replace(' ', 'T') + 'Z')
}

function dayKey(d) {
  return d.toLocaleDateString('sv')
}

function fmtSleep(ms) {
  if (!ms) return '—'
  const h = Math.floor(ms / 3600000)
  const m = Math.round((ms % 3600000) / 60000)
  return `${h}小时${String(m).padStart(2, '0')}分`
}

// 快照里步数/卡路里是当天累计值，睡眠是昨晚一整段——按天聚合时都取当天最大值
function aggregateByDay(rows) {
  const days = {}
  for (const r of rows) {
    const t = parseUtc(r.created_at)
    const k = dayKey(t)
    const d = days[k] || { steps: 0, calories: 0, sleep_ms: 0, bpmAvg: null, bpmMax: 0 }
    d.steps = Math.max(d.steps, r.steps || 0)
    d.calories = Math.max(d.calories, r.calories || 0)
    d.sleep_ms = Math.max(d.sleep_ms, r.sleep_ms || 0)
    if (r.bpm_avg) d.bpmAvg = r.bpm_avg // rows 按时间升序遍历后留最新一笔
    d.bpmMax = Math.max(d.bpmMax, r.bpm_max || 0)
    days[k] = d
  }
  return days
}

function Bars({ series, unit, color }) {
  const max = Math.max(...series.map((s) => s.value), 1)
  return (
    <div className="health-bars">
      {series.map((s) => (
        <div key={s.key} className={'health-bar-col' + (s.isToday ? ' today' : '')}>
          <div className="health-bar-val">{s.value > 0 ? s.label : ''}</div>
          <div className="health-bar-track">
            <div className="health-bar-fill" style={{ height: `${Math.max(3, (s.value / max) * 100)}%`, background: color }} />
          </div>
          <div className="health-bar-day">{s.week}</div>
        </div>
      ))}
      <div className="health-bars-unit">{unit}</div>
    </div>
  )
}

export default function HealthCard({ onClose }) {
  const moonMemory = useStore((s) => s.moonMemory)
  const cfg = { baseUrl: moonMemory?.baseUrl, apiToken: moonMemory?.apiToken }
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchVitals(cfg, 24 * 7, 1000)
      .then((r) => setRows(Array.isArray(r) ? r.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)) : []))
      .catch((e) => setError(e.message || '拉取失败'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const days = rows ? aggregateByDay(rows) : {}
  const latest = rows?.length ? rows[rows.length - 1] : null
  const todayK = dayKey(new Date())
  const today = days[todayK]

  // 近 7 天序列（含无数据的空天）
  const series = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const k = dayKey(d)
    series.push({ key: k, week: WEEK_CN[d.getDay()], data: days[k], isToday: i === 0 })
  }
  const sleepSeries = series.map((s) => ({
    ...s,
    value: s.data?.sleep_ms || 0,
    label: s.data?.sleep_ms ? (s.data.sleep_ms / 3600000).toFixed(1) : '',
  }))
  const stepSeries = series.map((s) => ({
    ...s,
    value: s.data?.steps || 0,
    label: s.data?.steps >= 1000 ? `${(s.data.steps / 1000).toFixed(1)}k` : String(s.data?.steps || ''),
  }))

  const lastReport = latest ? parseUtc(latest.created_at) : null

  return createPortal(
    <div className="health-overlay" onClick={onClose}>
      <div className="health-card" onClick={(e) => e.stopPropagation()}>
        <div className="health-head">
          <div className="health-title">身体气象站</div>
          <div className="health-sub">手环的悄悄话 · 涟言也在看着这份</div>
          <button className="health-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        {rows === null && !error && <div className="health-loading">听诊中……</div>}
        {error && <div className="health-loading">拉不到数据：{error}</div>}
        {rows?.length === 0 && <div className="health-loading">手环还没上报过数据<br />（检查 Tasker 是否在跑）</div>}

        {today && (
          <div className="health-tiles">
            <div className="health-tile">
              <div className="health-tile-label">昨晚睡眠</div>
              <div className="health-tile-value">{fmtSleep(today.sleep_ms)}</div>
            </div>
            <div className="health-tile">
              <div className="health-tile-label">今日步数</div>
              <div className="health-tile-value">{today.steps ? today.steps.toLocaleString() : '—'}</div>
            </div>
            <div className="health-tile">
              <div className="health-tile-label">心率 均值/峰值</div>
              <div className="health-tile-value">{today.bpmAvg || '—'}<span className="health-tile-minor"> / {today.bpmMax || '—'}</span></div>
            </div>
            <div className="health-tile">
              <div className="health-tile-label">今日消耗</div>
              <div className="health-tile-value">{today.calories ? Math.round(today.calories).toLocaleString() : '—'}<span className="health-tile-minor"> kcal</span></div>
            </div>
          </div>
        )}

        {rows?.length > 0 && (
          <>
            <div className="health-section-title">近七天 · 睡眠</div>
            <Bars series={sleepSeries} unit="小时" color="var(--accent)" />
            <div className="health-section-title">近七天 · 步数</div>
            <Bars series={stepSeries} unit="步" color="var(--accent-soft)" />
          </>
        )}

        {lastReport && (
          <div className="health-foot">
            最近上报 {String(lastReport.getMonth() + 1).padStart(2, '0')}-{String(lastReport.getDate()).padStart(2, '0')} {String(lastReport.getHours()).padStart(2, '0')}:{String(lastReport.getMinutes()).padStart(2, '0')} · 每一格都是你好好活着的证据
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
