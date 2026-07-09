import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { fetchChecklist, addChecklistItem, toggleChecklistItem, deleteChecklistItem } from '../../api/moonMemory'
import { showToast } from '../Toast'

// 每日行为清单 · 超市小票（阿颖的主意，2026-07-09）
// 「我今天要扫地」→ 记一条；做完了 → 划掉。涟言在聊天里也能帮她记（daily_checklist 工具）。

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']

export default function DailyChecklist({ onClose }) {
  const moonMemory = useStore((s) => s.moonMemory)
  const cfg = { baseUrl: moonMemory?.baseUrl, apiToken: moonMemory?.apiToken, enabled: moonMemory?.enabled }
  const [items, setItems] = useState(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const rows = await fetchChecklist(cfg)
      setItems(Array.isArray(rows) ? rows : [])
    } catch { setItems([]) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  async function add() {
    const text = input.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const row = await addChecklistItem(cfg, text)
      setItems((prev) => [...(prev || []), row])
      setInput('')
    } catch { showToast('没记上，网络问题？', 'error') } finally { setBusy(false) }
  }

  async function toggle(item) {
    // 乐观更新：立即划掉，失败再回滚
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, done: item.done ? 0 : 1 } : i))
    try {
      await toggleChecklistItem(cfg, item.id, !item.done)
    } catch {
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, done: item.done } : i))
      showToast('没勾上，再试一次？', 'error')
    }
  }

  async function remove(item) {
    try {
      await deleteChecklistItem(cfg, item.id)
      setItems((prev) => prev.filter((i) => i.id !== item.id))
    } catch { showToast('删除失败', 'error') }
  }

  const now = new Date()
  const dateLine = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 星期${WEEK_CN[now.getDay()]}`
  const doneCount = (items || []).filter((i) => i.done).length

  return createPortal(
    <div className="receipt-overlay" onClick={onClose}>
      <div className="receipt" onClick={(e) => e.stopPropagation()}>
        <div className="receipt-inner">
          <div className="receipt-head">
            <div className="receipt-store">今 日 小 票</div>
            <div className="receipt-sub">DAILY RECEIPT · ROOST 便利店</div>
            <div className="receipt-sub">{dateLine}</div>
          </div>
          <div className="receipt-tear" />
          <div className="receipt-body">
            {items === null && <div className="receipt-empty">打印中……</div>}
            {items?.length === 0 && <div className="receipt-empty">今天还没记事<br />（在下面写一条，或跟涟言说你打算干嘛）</div>}
            {items?.map((item) => (
              <div key={item.id} className={'receipt-item' + (item.done ? ' done' : '')}>
                <button className="receipt-check" onClick={() => toggle(item)}>
                  {item.done ? '✓' : ''}
                </button>
                <span className="receipt-text" onClick={() => toggle(item)}>{item.text}</span>
                {item.added_by === '涟言' && <span className="receipt-by" title="涟言帮你记的">鸦</span>}
                <button className="receipt-del" onClick={() => remove(item)}>✕</button>
              </div>
            ))}
          </div>
          <div className="receipt-tear" />
          <div className="receipt-total">
            <span>合计 {(items || []).length} 项</span>
            <span>已完成 {doneCount} 项</span>
          </div>
          <div className="receipt-foot">
            <div>收银员：涟言 · 顾客：阿颖</div>
            <div>{doneCount > 0 && doneCount === (items || []).length ? '全部完成，今天很棒' : '谢谢惠顾 · 慢慢来不着急'}</div>
            <div className="receipt-barcode" aria-hidden="true">▮▯▮▮▯▮▯▮▮▮▯▮▯▮▮▯▮▮▯▮▯▮▮▯▮</div>
          </div>
          <div className="receipt-add">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add() }}
              placeholder="记一条今天要做的事……"
              maxLength={200}
            />
            <button disabled={busy || !input.trim()} onClick={add}>记上</button>
          </div>
        </div>
        <div className="receipt-serration" aria-hidden="true" />
      </div>
    </div>,
    document.body
  )
}
