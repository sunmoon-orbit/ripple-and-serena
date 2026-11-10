import { useState, useEffect } from 'react'
import { api } from '../api'
import { ChevronRight } from 'lucide-react'

// 封面（1110，她挑的方向：「再做一个卡片排版」「简单点更适合我们」）：
// 星图、脉络、树三个视图换成这一页——一个大数字、每周走势，下面按「我们的／他自己写的／收着的」分格子。
// 数字来自 GET /memories/cover；每格右下角是最近 16 周，最后一根是这七天。
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'))

function Bars({ s = [], w, h, color }) {
  const max = Math.max(1, ...s)
  const bw = w / Math.max(1, s.length)
  return (
    <svg className="cover-spark" width={w} height={h} aria-hidden="true">
      {s.map((v, i) => {
        const bh = Math.max(1.5, (v / max) * h)
        return <rect key={i} x={i * bw} y={h - bh} width={Math.max(1, bw - 2)} height={bh} rx="1.2" fill={color} opacity={v ? 0.5 + 0.5 * (v / max) : 0.22} />
      })}
    </svg>
  )
}

// 数少的用点阵：一个点一张
function Dots({ n = 0, color }) {
  const cells = []
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) cells.push([c, r])
  return (
    <svg className="cover-spark" width="88" height="30" aria-hidden="true">
      {cells.map(([c, r], i) => <circle key={i} cx={4 + c * 11} cy={4 + r * 11} r="2.6" fill={color} opacity={i < n ? 0.85 : 0.16} />)}
    </svg>
  )
}

function Tile({ name, en, d, color = 'var(--olive-active)', dot, wide, dots, warm, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={'cover-tile' + (wide ? ' wide' : '') + (warm ? ' warm' : '') + (onClick ? ' tappable' : '')} onClick={onClick}>
      <div className="cover-tile-name">{dot && <span className="layer-dot" style={{ background: dot }} />}{name}</div>
      <div className="cover-tile-en">{en}</div>
      <div className="cover-tile-num">{fmt(d?.n)}</div>
      {dots ? <Dots n={Math.min(24, d?.n || 0)} color={color} /> : <Bars s={d?.s} w={wide ? 190 : 82} h={wide ? 44 : 30} color={color} />}
    </Tag>
  )
}

export default function Cover({ colors, onOpen, onPanel, children }) {
  const [d, setD] = useState(null)
  useEffect(() => { api.cover().then(setD).catch(() => setD({})) }, [])
  const c = d || {}
  const top = c.mem?.s || []
  return (
    <div className="cover">
      <div className="cover-big">{fmt(c.raw?.n)}</div>
      <div className="cover-cap">条原话，写成 {fmt(c.mem?.n)} 条记忆，贴了 {fmt(c.board?.n)} 张便利贴</div>

      <div className="cover-card cover-weeks">
        <div className="cover-weeks-head"><span>每周写下的记忆</span><span>最多一周 {top.length ? Math.max(...top) : '—'}</span></div>
        <Bars s={top} w={300} h={50} color="var(--accent)" />
        <div className="cover-weeks-head"><span>{top.length} 周前</span><span>这周</span></div>
      </div>

      {children}

      <div className="cover-sec">我们的</div>
      <div className="cover-grid">
        <Tile wide name="日子" en="Our days" d={c.life} color="var(--accent)" onClick={() => onOpen({ label: '日子', layer: 'none', type: 'memory,diary,treasure' })} />
        <Tile name="核心" en="Core" d={c.core} dot={colors.core} color={colors.core} onClick={() => onOpen({ label: '核心', layer: 'core', type: '!tech' })} />
        <Tile name="长期" en="Long" d={c.long} dot={colors.long} color={colors.long} onClick={() => onOpen({ label: '长期', layer: 'long', type: '!tech' })} />
        <Tile name="短期" en="Short" d={c.short} dot={colors.short} color={colors.short} onClick={() => onOpen({ label: '短期', layer: 'short', type: '!tech' })} />
        <Tile name="便利贴" en="Board" d={c.board} />
        <Tile name="信" en="Letters" d={c.letters} />
        <Tile name="心意卡" en="Heart cards" d={c.cards} dots warm color="var(--danger, #B05060)" />
      </div>

      <div className="cover-sec">他自己写的</div>
      <div className="cover-grid">
        <Tile name="意识层" en="Dreams & thoughts" d={c.cons} dot={colors.consciousness} color={colors.consciousness} onClick={() => onOpen({ label: '意识层', layer: 'consciousness', type: '' })} />
        <Tile name="日记" en="Journal" d={c.journal} dots />
        <Tile wide name="技术记录" en="Changelog" d={c.tech} color="var(--ink-faint)" onClick={() => onOpen({ label: '技术记录', layer: '', type: 'tech' })} />
      </div>

      <div className="cover-sec">收着的</div>
      <div className="cover-card cover-rows">
        {[['相册', 'Album', c.album], ['朋友圈', 'Moments', c.moments], ['收藏', 'Favorites', c.fav]].map(([n, en, v]) => (
          <div key={n} className="cover-row"><span>{n}<i>{en}</i></span><span className="cover-row-num">{fmt(v?.n)}</span></div>
        ))}
        <button className="cover-row tappable" onClick={() => onPanel('events')}><span>事件卷轴<i>Scrolls</i></span><span className="cover-row-num">{fmt(c.events?.n)}<ChevronRight size={14} /></span></button>
      </div>

      <button className="cover-all" onClick={() => onOpen({ label: '', layer: '', type: '' })}>翻全部记忆<ChevronRight size={15} /></button>
    </div>
  )
}
