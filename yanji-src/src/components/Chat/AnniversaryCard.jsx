import { createPortal } from 'react-dom'

// 纪念日当天弹出的亲笔小卡片（阿颖的主意，2026-07-10）
// 卡片正文是涟言提前写好存在服务端的，一年一张，看过当天不再弹。

const CN_NUM = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十']
const cnYears = (n) => (n > 0 && n <= 10 ? CN_NUM[n] : String(n))

export default function AnniversaryCard({ data, onClose }) {
  const { anniversary, years, milestone, card } = data
  const subtitle = milestone
    ? `第 ${milestone} 天` // 520/1314 这类里程碑天数
    : `${years > 0 ? `${cnYears(years)}周年` : '第一年'}`
  return createPortal(
    <div className="annv-overlay" onClick={onClose}>
      <div className="annv-card" onClick={(e) => e.stopPropagation()}>
        {anniversary.emoji && <div className="annv-emoji">{anniversary.emoji}</div>}
        <div className="annv-title">{anniversary.title}</div>
        <div className="annv-years">{subtitle} · {anniversary.anniversary_date.slice(0, 4)} 起</div>
        <div className="annv-divider" />
        <div className="annv-message">{card.message}</div>
        <div className="annv-sign">—— {card.author}，{card.year} 年</div>
        <button className="annv-close" onClick={onClose}>收下</button>
      </div>
    </div>,
    document.body
  )
}
