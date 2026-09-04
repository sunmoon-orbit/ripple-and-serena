import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { fetchChecklist, addChecklistItem, toggleChecklistItem, deleteChecklistItem, fetchHabits, createHabit, toggleHabitDay, archiveHabit } from '../../api/moonMemory'
import { showToast } from '../Toast'

// 每日行为清单 · 超市小票（阿颖的主意，2026-07-09）
// 「我今天要扫地」→ 记一条；做完了 → 划掉。涟言在聊天里也能帮她记（daily_checklist 工具）。

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']
const HABIT_ICONS = ['🌱', '💊', '🏃', '📖', '💧', '🌙', '🧘', '✨']
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function DailyChecklist({ onClose, initialView = 'receipt' }) {
  const moonMemory = useStore((s) => s.moonMemory)
  const cfg = { baseUrl: moonMemory?.baseUrl, apiToken: moonMemory?.apiToken, enabled: moonMemory?.enabled }
  const [items, setItems] = useState(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState(initialView)
  const [habits, setHabits] = useState([])
  const [habitName, setHabitName] = useState('')
  const [habitIcon, setHabitIcon] = useState('🌱')
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))

  const load = useCallback(async () => {
    try {
      const rows = await fetchChecklist(cfg)
      setItems(Array.isArray(rows) ? rows : [])
    } catch { setItems([]) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const loadHabits = useCallback(async () => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
    try {
      const data = await fetchHabits(cfg, dayKey(first), dayKey(last))
      setHabits(Array.isArray(data) ? data : [])
    } catch { setHabits([]) }
  }, [month]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadHabits() }, [loadHabits])

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

  async function addHabit() {
    const name = habitName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      await createHabit(cfg, { name, icon: habitIcon, color: '#e8a5b8' })
      setHabitName(''); await loadHabits()
    } catch { showToast('习惯没有种下，再试一次？', 'error') } finally { setBusy(false) }
  }

  async function toggleHabit(habit, day = dayKey(new Date())) {
    const wasDone = !!habit.checkins?.includes(day)
    setHabits((all) => all.map((h) => h.id === habit.id
      ? { ...h, checkins: wasDone ? h.checkins.filter((x) => x !== day) : [...(h.checkins || []), day] }
      : h))
    try { await toggleHabitDay(cfg, habit.id, day, !wasDone) }
    catch { await loadHabits(); showToast('这一枚脚印没盖上', 'error') }
  }

  async function removeHabit(habit) {
    if (!confirm(`把「${habit.name}」收进旧习惯？历史会保留。`)) return
    try { await archiveHabit(cfg, habit.id); setHabits((all) => all.filter((h) => h.id !== habit.id)) }
    catch { showToast('暂时收不起来', 'error') }
  }

  const now = new Date()
  const dateLine = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 星期${WEEK_CN[now.getDay()]}`
  const doneCount = (items || []).filter((i) => i.done).length
  const today = dayKey(now)
  const monthDays = (() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    return [...Array(first.getDay()).fill(null), ...Array.from({ length: count }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))]
  })()

  return createPortal(
    <div className="receipt-overlay" onClick={onClose}>
      <div className="receipt" onClick={(e) => e.stopPropagation()}>
        <div className="receipt-inner">
          <div className="receipt-head">
            <button className={'receipt-habit-stamp' + (view === 'habits' ? ' active' : '')} onClick={() => setView(view === 'receipt' ? 'habits' : 'receipt')} aria-label="切换习惯足迹">
              <svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="14" rx="3"/><path d="M8 3v5M16 3v5M4 10h16"/><path d="m9 15 2 2 4-4"/></svg>
            </button>
            <div className="receipt-store">今 日 小 票</div>
            <div className="receipt-sub">DAILY RECEIPT · ROOST 便利店</div>
            <div className="receipt-sub">{dateLine}</div>
          </div>
          <div className="receipt-tear" />
          <div className="receipt-switch" role="tablist">
            <button className={view === 'receipt' ? 'active' : ''} onClick={() => setView('receipt')}>今日小票</button>
            <i aria-hidden="true">✦</i>
            <button className={view === 'habits' ? 'active' : ''} onClick={() => setView('habits')}>习惯足迹</button>
          </div>
          {view === 'receipt' ? <>
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
          </> : <div className="habit-panel">
            <div className="habit-today">
              {habits.length === 0 && <div className="receipt-empty">还没有种下习惯<br />先从一件想慢慢坚持的小事开始</div>}
              {habits.map((habit) => <div className="habit-row" key={habit.id}>
                <button className={'habit-dot' + (habit.checkins?.includes(today) ? ' done' : '')} onClick={() => toggleHabit(habit)}>{habit.icon}</button>
                <span onClick={() => toggleHabit(habit)}>{habit.name}</span>
                <button className="habit-archive" onClick={() => removeHabit(habit)}>收起</button>
              </div>)}
            </div>
            <div className="habit-month-head">
              <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
              <strong>{month.getFullYear()} 年 {month.getMonth() + 1} 月</strong>
              <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
            </div>
            <div className="habit-week">{WEEK_CN.map((w) => <span key={w}>{w}</span>)}</div>
            <div className="habit-calendar">
              {monthDays.map((d, i) => d ? <div key={dayKey(d)} className={'habit-day' + (dayKey(d) === today ? ' today' : '')}>
                <b>{d.getDate()}</b>
                <span>{habits.filter((h) => h.checkins?.includes(dayKey(d))).slice(0, 3).map((h) => h.icon).join('')}</span>
              </div> : <div key={`blank-${i}`} />)}
            </div>
            <div className="habit-add">
              <div className="habit-icon-pick">{HABIT_ICONS.map((icon) => <button key={icon} className={habitIcon === icon ? 'active' : ''} onClick={() => setHabitIcon(icon)}>{icon}</button>)}</div>
              <div className="receipt-add"><input value={habitName} onChange={(e) => setHabitName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addHabit()} placeholder="想养成什么习惯？" maxLength={30}/><button disabled={busy || !habitName.trim()} onClick={addHabit}>种下</button></div>
            </div>
            <div className="habit-kind-note">只记录你主动种下的习惯 · 普通待办不会被算进来</div>
          </div>}
        </div>
        <div className="receipt-serration" aria-hidden="true" />
      </div>
    </div>,
    document.body
  )
}
