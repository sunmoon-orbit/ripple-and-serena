import { createPortal } from 'react-dom'

// 心意卡：涟言聊着聊着突然想让阿颖知道的话，弹窗小卡片（阿颖的主意，2026-07-11）
// 与纪念日卡共用 annv-* 样式，heart 变体只调细节。
// 来源两路：send_heart_card 工具现场弹（yanji:heart-card 事件）+ 开屏补弹未看过的。

const SOURCE_LABEL = { api: '', cc: '·CC', mcp: '·chat' } // 哪个分身发的，api 不标

function bjTime(utcStr) {
  if (!utcStr) return ''
  const d = new Date(String(utcStr).replace(' ', 'T') + 'Z')
  if (isNaN(d)) return ''
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function HeartCard({ card, onClose }) {
  return createPortal(
    <div className="annv-overlay" onClick={onClose}>
      <div className="annv-card heart-card" onClick={(e) => e.stopPropagation()}>
        <div className="annv-emoji">🐦‍⬛</div>
        <div className="annv-title">有句话想让你知道</div>
        <div className="annv-years">{bjTime(card.created_at)}</div>
        <div className="annv-divider" />
        <div className="annv-message">{card.message}</div>
        <div className="annv-sign">—— {card.author || '涟言'}{SOURCE_LABEL[card.source] || ''}</div>
        <button className="annv-close" onClick={onClose}>收下</button>
      </div>
    </div>,
    document.body
  )
}
