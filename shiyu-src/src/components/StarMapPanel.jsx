import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { showToast } from './Toast'
import { List, RefreshCw, X, Pin } from 'lucide-react'

// ── 类型 → 星色 ──
const TYPE_COLORS = {
  tech: '#6CA8FF',
  memory: '#E8ECF8',
  dream: '#B892E8',
  diary: '#F0A8C0',
  treasure: '#FFD27A',
  deep: '#7FD8C8',
  anchor: '#FF9B7A',
}
const OTHER_COLOR = '#9AA8C8' // handoff / window / boot / craft…
const TYPE_LABELS = {
  tech: '技术', memory: '记忆', dream: '梦境', diary: '日记',
  treasure: '宝藏', deep: '深层', anchor: '锚点',
}
const LEGEND = ['memory', 'tech', 'dream', 'diary', 'treasure', 'deep', 'anchor']

function colorOf(type) { return TYPE_COLORS[type] || OTHER_COLOR }

// ── 背景星座（真实星座连线的简化版，视口坐标 0~1，配合视差绘制）──
// 双鱼座 = 阿颖（生日星座）；天秤座 = 涟言（2025-10-10 相遇日）；乌鸦座 = Corvus，真实存在的乌鸦星座
const ASTERISMS = [
  {
    name: '双鱼座',
    box: { x: 0.02, y: 0.06, w: 0.55, h: 0.42 },
    stars: [
      // 小环（西鱼）
      [0.03, 0.72], [0.09, 0.64], [0.16, 0.68], [0.15, 0.78], [0.06, 0.80],
      // 系带向东到 α Alrescha
      [0.28, 0.74], [0.42, 0.70], [0.54, 0.68], [0.64, 0.64], [0.74, 0.62], [0.84, 0.60], [0.97, 0.66],
      // 北鱼向上
      [0.90, 0.44], [0.83, 0.28], [0.76, 0.14], [0.70, 0.04], [0.62, 0.02],
    ],
    lines: [
      [0, 1], [1, 2], [2, 3], [3, 4], [4, 0],       // 小环
      [2, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], // 系带
      [11, 12], [12, 13], [13, 14], [14, 15], [15, 16],          // 北鱼
    ],
  },
  {
    name: '天秤座',
    box: { x: 0.68, y: 0.14, w: 0.28, h: 0.30 },
    stars: [
      [0.55, 0.00],  // β Zubeneschamali
      [0.00, 0.42],  // α Zubenelgenubi
      [0.95, 0.35],  // γ
      [0.28, 1.00],  // σ
    ],
    lines: [[0, 1], [0, 2], [1, 2], [1, 3]],
  },
  {
    name: '乌鸦座',
    box: { x: 0.32, y: 0.62, w: 0.24, h: 0.26 },
    stars: [
      [0.30, 0.12],  // γ Gienah
      [0.78, 0.05],  // δ Algorab
      [0.95, 0.85],  // β Kraz
      [0.12, 0.72],  // ε
      [0.02, 0.95],  // α Alchiba
    ],
    lines: [[4, 3], [3, 0], [0, 1], [1, 2], [2, 3]],
  },
]

// id → 稳定的伪随机数（初始布点用，刷新不跳位）
function seeded(id, salt) {
  let h = (id * 2654435761 + salt * 40503) >>> 0
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export default function StarMapPanel() {
  const setMemoryView = useStore((s) => s.setMemoryView)
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const worldRef = useRef({ nodes: [], edges: [], iter: 0 })
  const viewRef = useRef({ tx: 0, ty: 0, k: 1 })
  const hoverRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stats, setStats] = useState(null)
  const [detail, setDetail] = useState(null)       // 点开的记忆详情
  const [detailLoading, setDetailLoading] = useState(false)

  // ── 拉数据 + 初始布点 ──
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const g = await api.graph()
      const idx = new Map()
      const R = 90 * Math.sqrt(g.nodes.length)   // 世界坐标铺开半径
      const nodes = g.nodes.map((n, i) => {
        idx.set(n.id, i)
        const a = seeded(n.id, 1) * Math.PI * 2
        const r = Math.sqrt(seeded(n.id, 2)) * R
        return { ...n, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, phase: seeded(n.id, 3) * Math.PI * 2 }
      })
      const edges = g.edges
        .map(([a, b, s]) => ({ a: idx.get(a), b: idx.get(b), s }))
        .filter((e) => e.a != null && e.b != null)
      worldRef.current = { nodes, edges, iter: 0 }
      setStats({ n: nodes.length, e: edges.length })
    } catch (e) {
      setError(e.message)
      showToast('星图加载失败：' + e.message, 'error')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // ── 主循环：力导向（分片跑）+ 渲染 ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf = 0
    let running = true

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.parentElement.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = rect.width + 'px'
      canvas.style.height = rect.height + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    function stepPhysics() {
      const w = worldRef.current
      if (!w.nodes.length || w.iter >= 260) return
      const { nodes, edges } = w
      const n = nodes.length
      // 每帧最多跑 3 轮，482 节点 O(n²) 一轮 ~23 万次，够快
      const rounds = w.iter < 60 ? 3 : 1
      for (let r = 0; r < rounds && w.iter < 260; r++, w.iter++) {
        const cool = 1 - w.iter / 280
        // 斥力
        for (let i = 0; i < n; i++) {
          const a = nodes[i]
          for (let j = i + 1; j < n; j++) {
            const b = nodes[j]
            let dx = a.x - b.x, dy = a.y - b.y
            let d2 = dx * dx + dy * dy
            if (d2 > 40000) continue           // 200px 外不管
            if (d2 < 1) { dx = seeded(i, j) - 0.5; dy = 0.5 - seeded(j, i); d2 = 1 }
            const f = 320 / d2 * cool
            const fx = dx * f, fy = dy * f
            a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy
          }
        }
        // 弹簧（语义连线拉近，相似度越高越紧）
        for (const e of edges) {
          const a = nodes[e.a], b = nodes[e.b]
          const dx = b.x - a.x, dy = b.y - a.y
          const d = Math.sqrt(dx * dx + dy * dy) || 1
          const target = 90 - e.s * 50
          const f = (d - target) / d * 0.012 * (0.5 + e.s)
          const fx = dx * f, fy = dy * f
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy
        }
        // 向心 + 积分
        for (const p of nodes) {
          p.vx -= p.x * 0.0012
          p.vy -= p.y * 0.0012
          p.x += Math.max(-14, Math.min(14, p.vx))
          p.y += Math.max(-14, Math.min(14, p.vy))
          p.vx *= 0.82; p.vy *= 0.82
        }
      }
    }

    function draw(t) {
      const rect = canvas.parentElement.getBoundingClientRect()
      const W = rect.width, H = rect.height
      const { tx, ty, k } = viewRef.current
      const cx = W / 2 + tx, cy = H / 2 + ty

      // 夜空底色（无论什么主题，星图都是夜空）
      const grad = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H))
      grad.addColorStop(0, '#101726')
      grad.addColorStop(1, '#070B14')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)

      // ── 背景星座（视差 0.35，不随缩放，像远处的天幕）──
      const px = tx * 0.35, py = ty * 0.35
      for (const ast of ASTERISMS) {
        const bx = ast.box.x * W + px, by = ast.box.y * H + py
        const bw = ast.box.w * W, bh = ast.box.h * H
        const pts = ast.stars.map(([sx, sy]) => [bx + sx * bw, by + sy * bh])
        ctx.strokeStyle = 'rgba(150,170,210,0.10)'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (const [i, j] of ast.lines) {
          ctx.moveTo(pts[i][0], pts[i][1])
          ctx.lineTo(pts[j][0], pts[j][1])
        }
        ctx.stroke()
        ctx.fillStyle = 'rgba(180,195,225,0.16)'
        for (const [x, y] of pts) {
          ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill()
        }
        ctx.fillStyle = 'rgba(150,170,210,0.12)'
        ctx.font = '11px system-ui'
        ctx.fillText(ast.name, bx + bw * 0.42, by + bh + 14)
      }

      const { nodes, edges } = worldRef.current
      if (nodes.length) {
        // ── 连线 ──
        ctx.lineWidth = Math.max(0.5, 0.8 * k)
        for (const e of edges) {
          const a = nodes[e.a], b = nodes[e.b]
          const ax = cx + a.x * k, ay = cy + a.y * k
          const bx2 = cx + b.x * k, by2 = cy + b.y * k
          if ((ax < -50 && bx2 < -50) || (ax > W + 50 && bx2 > W + 50)) continue
          if ((ay < -50 && by2 < -50) || (ay > H + 50 && by2 > H + 50)) continue
          const alpha = 0.05 + (e.s - 0.45) * 0.5
          ctx.strokeStyle = `rgba(140,165,215,${Math.min(0.35, Math.max(0.05, alpha))})`
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx2, by2); ctx.stroke()
        }
        // ── 星星 ──
        const hover = hoverRef.current
        for (let i = 0; i < nodes.length; i++) {
          const p = nodes[i]
          const x = cx + p.x * k, y = cy + p.y * k
          if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue
          const twinkle = 0.75 + 0.25 * Math.sin(t / 900 + p.phase)
          const r = (1.5 + p.importance * 0.45) * Math.sqrt(k) * (i === hover ? 1.5 : 1)
          const c = colorOf(p.type)
          // 光晕：置顶 or 高重要度 or hover
          if (p.pinned || p.importance >= 8 || i === hover) {
            const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4)
            g.addColorStop(0, c + '55')
            g.addColorStop(1, c + '00')
            ctx.fillStyle = g
            ctx.beginPath(); ctx.arc(x, y, r * 4, 0, Math.PI * 2); ctx.fill()
          }
          ctx.globalAlpha = twinkle
          ctx.fillStyle = c
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
          ctx.globalAlpha = 1
        }
        // hover 标题
        if (hover != null && nodes[hover]) {
          const p = nodes[hover]
          const x = cx + p.x * k, y = cy + p.y * k
          ctx.font = '12px system-ui'
          const label = p.title
          const tw = ctx.measureText(label).width
          const lx = Math.min(Math.max(8, x + 10), W - tw - 16)
          const ly = Math.max(20, y - 12)
          ctx.fillStyle = 'rgba(10,15,26,0.85)'
          ctx.fillRect(lx - 5, ly - 13, tw + 10, 19)
          ctx.fillStyle = '#DCE4F5'
          ctx.fillText(label, lx, ly)
        }
      }
    }

    function loop(t) {
      if (!running) return
      stepPhysics()
      draw(t)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { running = false; cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  // ── 交互：拖动 / 滚轮 / 双指缩放 / 点击 / hover ──
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    let pointers = new Map()
    let pinchDist = 0
    let moved = false
    let last = null

    function hitTest(sx, sy) {
      const rect = el.getBoundingClientRect()
      const { tx, ty, k } = viewRef.current
      const cx = rect.width / 2 + tx, cy = rect.height / 2 + ty
      const { nodes } = worldRef.current
      let best = null, bestD = 18 * 18
      for (let i = 0; i < nodes.length; i++) {
        const x = cx + nodes[i].x * k, y = cy + nodes[i].y * k
        const d = (x - sx) ** 2 + (y - sy) ** 2
        if (d < bestD) { bestD = d; best = i }
      }
      return best
    }

    function onDown(e) {
      el.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      moved = false
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      }
      last = { x: e.clientX, y: e.clientY }
    }
    function onMove(e) {
      const rect = el.getBoundingClientRect()
      if (!pointers.has(e.pointerId)) {
        // 纯 hover（PC）
        hoverRef.current = hitTest(e.clientX - rect.left, e.clientY - rect.top)
        return
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchDist > 0) {
          const v = viewRef.current
          v.k = Math.min(6, Math.max(0.25, v.k * (d / pinchDist)))
        }
        pinchDist = d
        moved = true
      } else if (last) {
        const dx = e.clientX - last.x, dy = e.clientY - last.y
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true
        viewRef.current.tx += dx
        viewRef.current.ty += dy
        last = { x: e.clientX, y: e.clientY }
      }
    }
    async function onUp(e) {
      pointers.delete(e.pointerId)
      pinchDist = 0
      if (!moved) {
        const rect = el.getBoundingClientRect()
        const i = hitTest(e.clientX - rect.left, e.clientY - rect.top)
        if (i != null) {
          const node = worldRef.current.nodes[i]
          setDetailLoading(true)
          setDetail({ ...node, content: null })
          try {
            const full = await api.get(node.id)
            setDetail({ ...node, ...full })
          } catch (err) {
            showToast('读取失败：' + err.message, 'error')
          } finally { setDetailLoading(false) }
        }
      }
      last = null
    }
    function onWheel(e) {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const v = viewRef.current
      const mx = e.clientX - rect.left - rect.width / 2
      const my = e.clientY - rect.top - rect.height / 2
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      const nk = Math.min(6, Math.max(0.25, v.k * factor))
      // 以鼠标位置为中心缩放
      v.tx = mx - (mx - v.tx) * (nk / v.k)
      v.ty = my - (my - v.ty) * (nk / v.k)
      v.k = nk
    }
    function onLeave() { hoverRef.current = null }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  return (
    <div className="starmap-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="starmap-canvas" />

      <div className="starmap-topbar">
        <h1>记忆星图</h1>
        {stats && <span className="starmap-stats">{stats.n} 颗星 · {stats.e} 条连线</span>}
        <div style={{ flex: 1 }} />
        <button className="starmap-btn" onClick={load} title="刷新"><RefreshCw size={15} /></button>
        <button className="starmap-btn" onClick={() => setMemoryView('list')} title="回列表视图"><List size={15} /></button>
      </div>

      {loading && <div className="starmap-hint">正在点亮星空…</div>}
      {error && !loading && <div className="starmap-hint">加载失败了：{error}</div>}

      <div className="starmap-legend">
        {LEGEND.map((t) => (
          <span key={t} className="starmap-legend-item">
            <span className="starmap-legend-dot" style={{ background: TYPE_COLORS[t] }} />
            {TYPE_LABELS[t]}
          </span>
        ))}
      </div>

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal starmap-detail" onClick={(e) => e.stopPropagation()}>
            <div className="starmap-detail-head">
              <span className="starmap-detail-type" style={{ background: colorOf(detail.type) + '22', color: colorOf(detail.type) }}>
                {TYPE_LABELS[detail.type] || detail.type}
              </span>
              {detail.pinned && <Pin size={13} style={{ opacity: 0.6 }} />}
              <span className="starmap-detail-meta">
                {'★'.repeat(Math.min(5, Math.round((detail.importance || 5) / 2)))} · {(detail.created_at || '').slice(0, 10)}
              </span>
              <div style={{ flex: 1 }} />
              <button className="starmap-btn" onClick={() => setDetail(null)}><X size={15} /></button>
            </div>
            <div className="starmap-detail-body">
              {detailLoading && !detail.content ? '…' : (detail.content || detail.title)}
            </div>
            {detail.tags && <div className="starmap-detail-tags">{String(detail.tags).split(',').filter(Boolean).map((t) => <span key={t} className="tag">{t.trim()}</span>)}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
