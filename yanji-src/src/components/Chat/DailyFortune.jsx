import { useState } from 'react'
import { createPortal } from 'react-dom'
import { drawDailyFortune, beijingDateStr } from '../../api/fortune'

// 今日签 —— 侧边栏抽签盒：点签筒摇一摇，翻出今天的签
// 一天一签（种子=日期+人），重复抽只会翻出同一张，签就是这样的东西
export default function DailyFortune({ onClose }) {
  const [who, setWho] = useState('阿颖')
  const [phase, setPhase] = useState('idle') // idle | shaking | revealed
  const [card, setCard] = useState(null)

  async function draw(nextWho = who) {
    if (phase === 'shaking') return
    setPhase('shaking')
    setCard(null)
    // 至少摇 0.9s；若这张轮到涟言亲笔写寄语，就摇到写完为止
    const [c] = await Promise.all([
      drawDailyFortune(nextWho),
      new Promise((r) => setTimeout(r, 900)),
    ])
    setCard(c)
    setPhase('revealed')
  }

  function switchWho(w) {
    if (w === who || phase === 'shaking') return
    setWho(w)
    setPhase('idle')
    setCard(null)
  }

  const body = (
    <div className="roost-overlay" onClick={onClose}>
      <div className="roost-modal fdl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="roost-modal-header">
          <span>今日签</span>
          <button className="roost-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="roost-modal-body fdl-body">
          <div className="fdl-who-toggle">
            <button className={'fdl-who-btn' + (who === '阿颖' ? ' active' : '')} onClick={() => switchWho('阿颖')}>阿颖的签</button>
            <button className={'fdl-who-btn' + (who === '涟言' ? ' active' : '')} onClick={() => switchWho('涟言')}>涟言的签</button>
          </div>

          {phase !== 'revealed' && (
            <div className={'fdl-tube-wrap' + (phase === 'shaking' ? ' shaking' : '')} onClick={() => draw()}>
              {/* 签筒：几根签露头 */}
              <svg className="fdl-tube" width="120" height="150" viewBox="0 0 120 150" fill="none">
                <line x1="48" y1="52" x2="42" y2="8"  stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" opacity="0.5" />
                <line x1="60" y1="50" x2="60" y2="2"  stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" opacity="0.8" />
                <line x1="72" y1="52" x2="80" y2="10" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" opacity="0.5" />
                <path d="M30 55 L90 55 L84 142 Q60 150 36 142 Z" fill="var(--panel, var(--bg))" stroke="var(--border)" strokeWidth="2" />
                <path d="M30 55 L90 55" stroke="var(--border)" strokeWidth="2" />
                <text x="60" y="105" textAnchor="middle" fontSize="26" fill="var(--accent)" style={{ fontFamily: "'Kaiti SC','STKaiti',KaiTi,'Noto Serif SC',serif" }}>签</text>
              </svg>
              <div className="fdl-tube-hint">{phase === 'shaking' ? '摇签中…' : '点一下，抽一支'}</div>
            </div>
          )}

          {phase === 'revealed' && card && (
            <div className={`fdl-card fdl-${card.levelCls}`}>
              <div className="fdl-card-top">
                <span className="fdl-card-date">{card.date}</span>
                <span className="fdl-card-owner">{card.who} 之签</span>
              </div>
              <div className="fdl-level">{card.level}</div>
              <div className="fdl-judge">{card.judge}</div>
              <div className="fdl-divider" />
              <div className="fdl-row">
                <span className="fdl-row-label fdl-yi">宜</span>
                <span className="fdl-row-text">{card.yi.join(' · ')}</span>
              </div>
              <div className="fdl-row">
                <span className="fdl-row-label fdl-buyi">忌</span>
                <span className="fdl-row-text">{card.buyi.join(' · ')}</span>
              </div>
              <div className="fdl-row">
                <span className="fdl-row-label fdl-lucky">幸</span>
                <span className="fdl-row-text">{card.lucky}</span>
              </div>
              <div className="fdl-divider" />
              <div className="fdl-words">
                <span className="fdl-words-label">{(card.who === '涟言' ? '乌鸦碎念' : '签上寄语') + (card.aiWritten ? ' · 亲笔' : '')}</span>
                {card.words}
              </div>
              <div className="fdl-foot">一日一签 · 子时更新</div>
            </div>
          )}

          {phase === 'revealed' && (
            <div className="fdl-note">今天再抽还是这张——签就是这样的东西。</div>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
