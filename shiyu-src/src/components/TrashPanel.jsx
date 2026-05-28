import { useState, useEffect } from 'react'
import { api } from '../api'
import { showToast } from './Toast'
import { RotateCcw } from 'lucide-react'

export default function TrashPanel() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true); setError('')
    try { setItems(await api.trash()) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function restore(m) {
    try { await api.restore(m.id); showToast('已恢复到记忆库'); load() }
    catch (e) { showToast(e.message, 'error') }
  }

  return (
    <div className="panel">
      <div className="topbar"><h1>回收站</h1></div>
      <div className="heatmap-legend" style={{ margin: '0 4px 16px' }}>软删除的记忆都在这里，可随时恢复 · 共 {items.length} 条</div>
      {error && <div className="error-box">{error}</div>}
      {!error && items.length === 0 && !loading && <div className="empty">回收站是空的</div>}
      <div className="mem-list">
        {items.map((m) => (
          <div className="card" key={m.id}>
            <div className="card-content" style={{ maxHeight: 130 }}>{m.content}<div className="card-fade" /></div>
            <div className="card-footer">
              <span className="card-date">{String(m.deleted_at || '').slice(0, 10)} 删除</span>
              <button className="btn btn-ghost" onClick={() => restore(m)}><RotateCcw size={15} />恢复</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
