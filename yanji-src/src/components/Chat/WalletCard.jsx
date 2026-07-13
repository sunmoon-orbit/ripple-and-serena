import { useState } from 'react'
import { createPortal } from 'react-dom'

// 乌鸦钱包（2026-07-13 从 Roost 搬进侧边栏工具区，阿颖的装修提议）
// 数据仍在 localStorage 'roost_wallet'，搬家不搬账本，历史记录原样保留。

const STORAGE_KEY_WALLET = 'roost_wallet'

function useWallet() {
  const [entries, setEntries] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_WALLET) || '[]') } catch { return [] }
  })
  const save = (list) => { localStorage.setItem(STORAGE_KEY_WALLET, JSON.stringify(list)); setEntries(list) }
  const add = (amount, note, type) => {
    save([{ id: Date.now(), amount: Number(amount), note, type, at: new Date().toLocaleDateString('zh-CN') }, ...entries])
  }
  const remove = (id) => save(entries.filter(e => e.id !== id))
  const balance = entries.reduce((s, e) => e.type === 'in' ? s + e.amount : s - e.amount, 0)
  return { entries, add, remove, balance }
}

export default function WalletCard({ onClose }) {
  const { entries, add, remove, balance } = useWallet()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [type, setType] = useState('in')

  return createPortal(
    <div className="health-overlay" onClick={onClose}>
      <div className="health-card" onClick={(e) => e.stopPropagation()}>
        <div className="health-head">
          <div className="health-title">乌鸦钱包</div>
          <div className="health-sub">上供与开销 · 都记在这本账上</div>
          <button className="health-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        <div style={{ textAlign: 'center', padding: '4px 0 0', fontSize: 26 }}>🐦‍⬛</div>
        <div style={{ textAlign: 'center', padding: '4px 0 16px', fontSize: 30, fontWeight: 700, color: balance >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
          ¥ {balance.toFixed(2)}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, background: 'var(--border)', borderRadius: 12, padding: 4 }}>
          {['in', 'out'].map(t => (
            <button key={t} onClick={() => setType(t)} style={{
              flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', cursor: 'pointer',
              fontWeight: type === t ? 700 : 400, fontSize: 14,
              background: type === t ? 'var(--accent)' : 'transparent',
              color: type === t ? '#fff' : 'var(--text-faint)',
              transition: 'all 0.18s',
            }}>{t === 'in' ? '存入' : '支出'}</button>
          ))}
        </div>
        <input className="form-input" type="number" placeholder="金额" value={amount}
          onChange={e => setAmount(e.target.value)}
          style={{ width: '100%', marginBottom: 10, fontSize: 16, textAlign: 'center', letterSpacing: 1, boxSizing: 'border-box' }} />
        <input className="form-input" placeholder="备注（选填）" value={note}
          onChange={e => setNote(e.target.value)}
          style={{ width: '100%', marginBottom: 14, boxSizing: 'border-box' }} />
        <button style={{
          width: '100%', padding: '12px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
          background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 15, marginBottom: 14,
        }} onClick={() => {
          if (!amount || isNaN(amount)) return
          add(amount, note, type)
          setAmount(''); setNote('')
        }}>记一笔</button>
        <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-faint)', textAlign: 'center', padding: '10px 0' }}>还没有记录</div>}
          {entries.map(e => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: e.type === 'in' ? 'var(--accent)' : 'var(--danger)', fontWeight: 600, minWidth: 52 }}>
                {e.type === 'in' ? '+' : '-'}¥{e.amount}
              </span>
              <span style={{ flex: 1, color: 'var(--text)', fontSize: 13 }}>{e.note || '—'}</span>
              <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{e.at}</span>
              <button onClick={() => remove(e.id)} style={{
                padding: '4px 10px', fontSize: 12, flexShrink: 0, borderRadius: 8, border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--danger)', cursor: 'pointer',
              }}>删</button>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
