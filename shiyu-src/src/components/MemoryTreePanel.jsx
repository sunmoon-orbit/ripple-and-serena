import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { showToast } from './Toast'
import { List, RefreshCw, X, Pin, Maximize2 } from 'lucide-react'
import { clusterNodes, nameClusters, seeded, TYPE_LABELS, TYPE_TINT } from './MemoryVeinPanel'
import { IS_ZHAOHUA } from '../config'

// 记忆之树（0929 第三版）：阿颖——散开的脉络「有点丑、没有主体物」，想要一棵竖着长的树，
// 曜——「植物标本 × 墨线」，不要绿色圆冠的卡通树。
// 对应关系：树干 = 时间（根是最早那条记忆，越往上越新）；主枝 = 主题簇（从它开始出现的高度长出）；
// 叶 = 一条记忆（越重要越大）；置顶的是花。记忆越多树越高，新记忆只在枝梢抽芽，不打乱原来的样子。
// 手机：布局一次算定，只在拖/缩/点时重画一帧；开场从根往上长一遍，一天只长一次。

const MIN_K = 0.25, MAX_K = 5
const LABEL_ZOOM = 1.6
const MAX_LABELS = 30
const INTRO_MS = 1600
const INTRO_KEY = IS_ZHAOHUA ? 'zhaohua-plaque-tree-intro-day' : 'shiyu-tree-intro-day'
const DAY = 86400000

function timeOf(n) { const t = Date.parse(n.created_at || ''); return Number.isFinite(t) ? t : 0 }
function quantile(sorted, q) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0 }
// 二次贝塞尔上的点和切线
function bez(p0, c, p1, u) {
  const v = 1 - u
  return [v * v * p0[0] + 2 * v * u * c[0] + u * u * p1[0], v * v * p0[1] + 2 * v * u * c[1] + u * u * p1[1]]
}
function bezTan(p0, c, p1, u) {
  const dx = 2 * (1 - u) * (c[0] - p0[0]) + 2 * u * (p1[0] - c[0])
  const dy = 2 * (1 - u) * (c[1] - p0[1]) + 2 * u * (p1[1] - c[1])
  const l = Math.hypot(dx, dy) || 1
  return [dx / l, dy / l]
}

function buildTree(g) {
  const idx = new Map()
  const nodes = g.nodes.map((n, i) => {
    idx.set(n.id, i)
    return { ...n, title: n.title || String(n.content || '').split('\n')[0].slice(0, 48), t: timeOf(n) }
  })
  const adj = nodes.map(() => [])
  for (const [a, b, s] of g.edges || []) {
    const i = idx.get(a), j = idx.get(b)
    if (i == null || j == null) continue
    adj[i].push([j, s]); adj[j].push([i, s])
  }
  nodes.forEach((n, i) => { n.neighbors = adj[i] })
  const times = nodes.map((n) => n.t).filter(Boolean).sort((a, b) => a - b)
  const t0 = times[0] || Date.now(), t1 = Math.max(times[times.length - 1] || t0, t0 + DAY)
  const { clusters, looseIndex } = clusterNodes(nodes, adj)
  const names = nameClusters(clusters, nodes, looseIndex)

  // 树高随记忆数慢慢长：几百条是一棵小树，几千条会高很多，但不会无限拉长
  const H = 460 + 190 * Math.log2(1 + nodes.length / 60)
  const rootY = 0
  const yOf = (t) => rootY - H * (0.08 + 0.9 * (t - t0) / (t1 - t0))
  const trunkX = (y) => 7 * Math.sin(y / 150) + 4 * Math.sin(y / 47 + 1.3)
  const topY = yOf(t1)

  // 主枝：每簇从它 15% 分位时间的高度长出；左右交替但按已占的「分量」平衡；同侧相邻枝至少隔一段
  const branches = []
  const order = clusters.map((m, ci) => ci).filter((ci) => ci !== looseIndex)
    .map((ci) => ({ ci, tb: quantile(clusters[ci].map((i) => nodes[i].t).sort((a, b) => a - b), 0.15) }))
    .sort((a, b) => a.tb - b.tb)
  const weight = { [-1]: 0, [1]: 0 }
  const lastY = { [-1]: Infinity, [1]: Infinity }
  for (const { ci, tb } of order) {
    const members = clusters[ci]
    const side = weight[-1] <= weight[1] ? -1 : 1
    weight[side] += members.length
    let by = Math.min(yOf(tb), rootY - H * 0.12)
    if (lastY[side] - by < 46) by = lastY[side] - 46
    by = Math.max(by, topY + 40)
    lastY[side] = by
    const bx = trunkX(by)
    // 第二版（0929）：高度 = 时间，对叶子也成立。枝先往外伸，再往上长到这簇最新那条记忆的高度，
    // 所以上半截树干旁边也有枝梢，不会只剩一根光杆。
    const ts = members.map((i) => nodes[i].t).sort((a, b) => a - b)
    const tl = quantile(ts, 0.98)
    // 往上长一半路程就停（全长到最新会变成一排竖直的烛台，0929 试过）
    const tipY = Math.min(by - 60, by - (by - yOf(tl)) * 0.5)
    const w = 70 + 16 * Math.sqrt(members.length) + seeded(ci + 11, 3) * 24
    const len = Math.hypot(w, by - tipY)
    const tip = [bx + side * w, tipY]
    // 控制点：几乎水平地伸出去，拐个弯再往上，像被光拉着长
    const ctrl = [bx + side * w * 0.8, by - (by - tipY) * 0.18 + (seeded(ci + 3, 5) - 0.5) * 14]
    branches.push({ ci, side, base: [bx, by], ctrl, tip, tb, tl, len, name: names[ci], members })
  }

  // 叶：沿枝按时间排，从枝上长出一小截细梗，梗端是叶
  const leaves = []
  const twigs = []
  for (const b of branches) {
    const ms = [...b.members].sort((x, y) => nodes[x].t - nodes[y].t)
    ms.forEach((i, k) => {
      const n = nodes[i]
      const span = Math.max(DAY, b.tl - b.tb)
      const tf = Math.min(1, Math.max(0, (n.t - b.tb) / span))
      const u = 0.08 + 0.9 * (0.75 * tf + 0.25 * (k / Math.max(1, ms.length - 1)))
      const p = bez(b.base, b.ctrl, b.tip, Math.min(0.99, u))
      const tan = bezTan(b.base, b.ctrl, b.tip, Math.min(0.99, u))
      const alt = k % 2 ? 1 : -1
      // 梗和枝成 40~65 度，并且偏向上方
      const rot = alt * (0.7 + seeded(n.id, 31) * 0.45)
      let dx = tan[0] * Math.cos(rot) - tan[1] * Math.sin(rot)
      let dy = tan[0] * Math.sin(rot) + tan[1] * Math.cos(rot)
      if (dy > 0.2) { dy = -dy * 0.6; dx *= 1.1 }
      const tl = 8 + (n.importance || 5) * 1.6 + seeded(n.id, 32) * 6
      const q = [p[0] + dx * tl, p[1] + dy * tl]
      twigs.push({ from: p, to: q, t: n.t, i })
      n.x = q[0]; n.y = q[1]; n.leafAngle = Math.atan2(dy, dx); n.branch = b
      leaves.push(i)
    })
  }
  // 零散的：直接从树干上发短芽
  if (looseIndex >= 0) {
    clusters[looseIndex].forEach((i, k) => {
      const n = nodes[i]
      const y = yOf(n.t), x = trunkX(y)
      const side = k % 2 ? 1 : -1
      const q = [x + side * (12 + (n.importance || 5)), y - 8]
      twigs.push({ from: [x, y], to: q, t: n.t, i })
      n.x = q[0]; n.y = q[1]; n.leafAngle = Math.atan2(-8, side * 12)
      leaves.push(i)
    })
  }

  // 树干上的时间刻度：每两个月一格（跨度短就每月）
  const ticks = []
  const d0 = new Date(t0)
  const monthsSpan = (t1 - t0) / (30 * DAY)
  const every = monthsSpan > 14 ? 3 : monthsSpan > 6 ? 2 : 1
  for (let d = new Date(d0.getFullYear(), d0.getMonth() + 1, 1); d.getTime() <= t1; d = new Date(d.getFullYear(), d.getMonth() + every, 1)) {
    ticks.push({ y: yOf(d.getTime()), label: `${d.getFullYear()}·${String(d.getMonth() + 1).padStart(2, '0')}`, t: d.getTime() })
  }

  // 外包框
  let x0 = -40, x1 = 40, y0 = topY - 30, y1 = rootY + 40
  for (const n of nodes) if (n.x != null) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y) }
  for (const b of branches) { x0 = Math.min(x0, b.tip[0] - 40); x1 = Math.max(x1, b.tip[0] + 40); y0 = Math.min(y0, b.tip[1] - 20) }

  return { nodes, branches, twigs, leaves, ticks, t0, t1, H, rootY, topY, yOf, trunkX, box: [x0, y0, x1, y1] }
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export default function MemoryTreePanel() {
  const setMemoryView = useStore((s) => s.setMemoryView)
  const theme = useStore((s) => s.theme)
  const canvasRef = useRef(null)
  const treeRef = useRef(null)
  const viewRef = useRef({ tx: 0, ty: 0, k: 1 })
  const selRef = useRef(null)
  const introRef = useRef({ start: 0, done: true })
  const redrawRef = useRef(() => {})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stats, setStats] = useState(null)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const fitView = useCallback(() => {
    const T = treeRef.current, c = canvasRef.current
    if (!T || !c) return
    const rect = c.getBoundingClientRect()
    const [x0, y0, x1, y1] = T.box
    const top = 76, bottom = 96
    const k = Math.max(MIN_K, Math.min(1.4, (rect.width - 24) / (x1 - x0), (rect.height - top - bottom) / (y1 - y0)))
    viewRef.current = { tx: -((x0 + x1) / 2) * k, ty: -((y0 + y1) / 2) * k + (top - bottom) / 2, k }
    redrawRef.current()
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const g = await api.graph()
      const T = buildTree(g)
      treeRef.current = T
      selRef.current = null; setSelected(null)
      setStats({ n: T.nodes.length, b: T.branches.length, p: T.nodes.filter((n) => n.pinned || (n.importance || 5) >= 7).length })
      const today = new Date().toDateString()
      let seen = ''
      try { seen = localStorage.getItem(INTRO_KEY) || '' } catch {}
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      introRef.current = { start: 0, done: reduced || seen === today }
      try { localStorage.setItem(INTRO_KEY, today) } catch {}
      requestAnimationFrame(fitView)
    } catch (e) {
      setError(e.message)
      showToast('记忆之树加载失败：' + e.message, 'error')
    } finally { setLoading(false) }
  }, [fitView])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let pending = 0

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.parentElement.getBoundingClientRect()
      canvas.width = rect.width * dpr; canvas.height = rect.height * dpr
      canvas.style.width = rect.width + 'px'; canvas.style.height = rect.height + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      schedule()
    }

    function draw(t) {
      pending = 0
      const rect = canvas.parentElement.getBoundingClientRect()
      const W = rect.width, Hs = rect.height
      const bg = cssVar('--bg', '#ECEEF4')
      const ink = cssVar('--ink', '#1C2130')
      const inkSoft = cssVar('--ink-soft', '#5A6070')
      const inkFaint = cssVar('--ink-faint', '#9AA0B0')
      const accent = IS_ZHAOHUA
        ? (theme === 'midnight' ? '#C8B387' : '#7D6748')
        : cssVar('--accent', '#A07850')
      const dark = theme === 'midnight'
      ctx.globalAlpha = 1
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, Hs)
      const T = treeRef.current
      if (!T || !T.nodes.length) return

      const intro = introRef.current
      if (!intro.done && !intro.start) intro.start = t
      const progress = intro.done ? 1 : Math.min(1, (t - intro.start) / INTRO_MS)
      if (progress >= 1) intro.done = true
      // 开场按时间往上长：progress 映射到「长到哪一天」
      const ease = 1 - Math.pow(1 - progress, 2)
      const tc = T.t0 + (T.t1 - T.t0) * ease

      const { tx, ty, k } = viewRef.current
      const cx = W / 2 + tx, cy = Hs / 2 + ty
      const X = (x) => cx + x * k, Y = (y) => cy + y * k
      const sel = selRef.current
      const selSet = sel != null ? new Set([sel, ...T.nodes[sel].neighbors.map(([j]) => j)]) : null
      const trunkInk = IS_ZHAOHUA
        ? (dark ? '#778296' : '#3F4855')
        : (dark ? inkSoft : ink)

      const label = (text, x, y, font, color, alpha, align = 'center') => {
        ctx.font = font; ctx.textAlign = align; ctx.globalAlpha = alpha
        ctx.lineWidth = 4; ctx.strokeStyle = bg; ctx.lineJoin = 'round'
        ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y)
        ctx.textAlign = 'left'
      }
      // 一笔带粗细变化的线：沿中线两侧偏移成一个填充多边形，一次画完。
      // （分段描边会在接头处叠色，出一节一节的竹节纹——0929 第一张截图就是这样）
      const taper = (pts, w0, w1, color, alpha) => {
        if (pts.length < 2) return
        const L = [], R = []
        for (let i = 0; i < pts.length; i++) {
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]
          let nx = -(b[1] - a[1]), ny = b[0] - a[0]
          const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l
          const w = Math.max(0.35 / k, (w0 + (w1 - w0) * i / (pts.length - 1)) / 2)
          L.push([X(pts[i][0] + nx * w), Y(pts[i][1] + ny * w)])
          R.push([X(pts[i][0] - nx * w), Y(pts[i][1] - ny * w)])
        }
        ctx.fillStyle = color; ctx.globalAlpha = alpha
        ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1])
        for (const p of L.slice(1)) ctx.lineTo(p[0], p[1])
        for (const p of R.reverse()) ctx.lineTo(p[0], p[1])
        ctx.closePath(); ctx.fill()
      }

      // 地面与根：几笔短而弯的根须，一条极淡的地平线
      const gy = T.rootY + 6
      ctx.globalAlpha = 0.18; ctx.strokeStyle = inkSoft; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(X(-120), Y(gy)); ctx.lineTo(X(120), Y(gy)); ctx.stroke()
      for (let r = 0; r < 5; r++) {
        const dir = (r - 2) * 0.42
        const pts = []
        for (let s = 0; s <= 6; s++) pts.push([Math.sin(dir) * s * 7 + (seeded(r + 9, s) - 0.5) * 3, gy + s * 3.2])
        taper(pts, 3.2, 0.6, trunkInk, 0.55 * ease)
      }

      // 树干：从根长到 tc 对应的高度，下粗上细
      const trunkTop = T.yOf(tc)
      const tpts = []
      for (let y = T.rootY; y >= trunkTop; y -= 10) tpts.push([T.trunkX(y), y])
      tpts.push([T.trunkX(trunkTop), trunkTop])
      const full = (T.rootY - trunkTop) / (T.rootY - T.topY)
      taper(tpts, 11, 11 - 8.5 * full, trunkInk, 0.85)

      // 时间刻度：像标本图边上的注记，写在树干左边
      for (const tk of T.ticks) {
        if (tk.t > tc) continue
        const x = T.trunkX(tk.y)
        ctx.globalAlpha = 0.35; ctx.strokeStyle = inkFaint; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(X(x - 16), Y(tk.y)); ctx.lineTo(X(x - 9), Y(tk.y)); ctx.stroke()
        label(tk.label, X(x - 20), Y(tk.y) + 3, 'italic 10px Georgia, "Noto Serif SC", serif', inkFaint, 0.75, 'right')
      }
      // 最底下一条：我们开始的那天
      label(new Date(T.t0).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }), X(0), Y(gy) + 22,
        'italic 10px Georgia, "Noto Serif SC", serif', inkFaint, 0.8 * ease)

      // 主枝：到了它出现的时间才开始长
      for (const b of T.branches) {
        if (b.tb > tc) continue
        const grow = Math.min(1, 0.08 + (tc - b.tb) / Math.max(DAY, b.tl - b.tb))
        const pts = []
        for (let s = 0; s <= 14; s++) pts.push(bez(b.base, b.ctrl, b.tip, (s / 14) * grow))
        const dim = selSet && !b.members.some((i) => selSet.has(i))
        taper(pts, 4.2 + Math.sqrt(b.members.length) * 0.18, 0.7, trunkInk, dim ? 0.25 : 0.78)
      }

      // 细梗 + 叶
      const leafColor = (n) => IS_ZHAOHUA
        ? (dark ? '#94A097' : '#607267')
        : n.type === 'memory' ? accent : `hsl(${TYPE_TINT[n.type] ?? 30} 24% ${dark ? 66 : 42}%)`
      for (const tw of T.twigs) {
        if (tw.t > tc) continue
        const n = T.nodes[tw.i]
        const dim = selSet && !selSet.has(tw.i)
        ctx.globalAlpha = dim ? 0.12 : 0.5
        ctx.strokeStyle = trunkInk; ctx.lineWidth = Math.max(0.4, 0.7 * k)
        ctx.beginPath(); ctx.moveTo(X(tw.from[0]), Y(tw.from[1])); ctx.lineTo(X(tw.to[0]), Y(tw.to[1])); ctx.stroke()
        const x = X(n.x), y = Y(n.y)
        if (x < -20 || x > W + 20 || y < -20 || y > Hs + 20) continue
        const size = (2.2 + (n.importance || 5) * 0.42) * Math.sqrt(k) * (tw.i === sel ? 1.6 : 1)
        ctx.globalAlpha = dim ? 0.15 : 0.78
        const plaque = IS_ZHAOHUA && (n.pinned || (n.importance || 5) >= 7)
        if (plaque) {
          // 昭华：普通记忆长成叶，只有重要记忆被郑重地挂成木牌。
          // 木牌按世界缩放绘制，远景是树冠里的小轮廓，拉近才能读字。
          const pw = Math.max(7, (n.pinned ? 17 : 14) * Math.sqrt(k))
          const ph = pw * 1.25
          const py = y + ph * 0.7
          const tilt = (seeded(n.id, 77) - 0.5) * 0.12
          ctx.save()
          ctx.translate(x, py); ctx.rotate(tilt)
          ctx.globalAlpha = dim ? 0.16 : 0.9
          ctx.strokeStyle = dark ? '#D2C39F' : '#725B3B'
          ctx.lineWidth = Math.max(0.7, 0.9 * Math.sqrt(k))
          ctx.beginPath(); ctx.moveTo(0, -ph * 0.72); ctx.lineTo(0, -ph / 2); ctx.stroke()
          ctx.fillStyle = dark ? '#615744' : '#C8AA79'
          ctx.strokeStyle = dark ? '#B7A57D' : '#765F3F'
          ctx.beginPath()
          ctx.roundRect(-pw / 2, -ph / 2, pw, ph, Math.max(1.5, pw * 0.09))
          ctx.fill(); ctx.stroke()
          ctx.globalAlpha = dim ? 0.08 : 0.24
          ctx.strokeStyle = dark ? '#E3D7BA' : '#5E482F'; ctx.lineWidth = 0.55
          for (let gy = -ph * 0.3; gy < ph * 0.35; gy += Math.max(3, ph * 0.22)) {
            ctx.beginPath(); ctx.moveTo(-pw * 0.35, gy); ctx.lineTo(pw * 0.35, gy); ctx.stroke()
          }
          if (k >= 1.05 || tw.i === sel) {
            const txt = String(n.title || '').replace(/\s+/g, '').slice(0, 4)
            ctx.globalAlpha = dim ? 0.15 : 0.9
            ctx.fillStyle = dark ? '#F2E8D0' : '#3F3020'
            ctx.font = `600 ${Math.max(6, Math.min(10, pw * 0.32))}px "Noto Serif SC", serif`
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
            ctx.fillText(txt.slice(0, 2), 0, txt.length > 2 ? -3 : 0)
            if (txt.length > 2) ctx.fillText(txt.slice(2), 0, 4)
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
          }
          ctx.restore()
        } else if (n.pinned) {
          // 置顶：五瓣小花
          ctx.fillStyle = dark ? '#E8C9A0' : '#B7704F'
          for (let p = 0; p < 5; p++) {
            const a = p * Math.PI * 2 / 5 + n.leafAngle
            ctx.beginPath(); ctx.arc(x + Math.cos(a) * size * 0.55, y + Math.sin(a) * size * 0.55, size * 0.42, 0, Math.PI * 2); ctx.fill()
          }
          ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(x, y, size * 0.25, 0, Math.PI * 2); ctx.fill()
        } else {
          ctx.fillStyle = leafColor(n)
          ctx.beginPath(); ctx.ellipse(x, y, size, size * 0.42, n.leafAngle, 0, Math.PI * 2); ctx.fill()
          // 一道叶脉
          ctx.globalAlpha *= 0.5; ctx.strokeStyle = bg; ctx.lineWidth = 0.6
          ctx.beginPath(); ctx.moveTo(x - Math.cos(n.leafAngle) * size * 0.8, y - Math.sin(n.leafAngle) * size * 0.8)
          ctx.lineTo(x + Math.cos(n.leafAngle) * size * 0.8, y + Math.sin(n.leafAngle) * size * 0.8); ctx.stroke()
        }
      }

      // 选中：它语义相近的其它叶子，用细虚线牵出来（跨枝的关系只在这时浮现）
      if (sel != null && progress >= 1) {
        const p = T.nodes[sel]
        ctx.setLineDash([3, 4]); ctx.lineWidth = 0.9; ctx.strokeStyle = ink
        for (const [j, s] of p.neighbors) {
          const q = T.nodes[j]
          ctx.globalAlpha = 0.2 + s * 0.45
          ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(X(q.x), Y(q.y)); ctx.stroke()
        }
        ctx.setLineDash([])
      }

      // 枝名：写在枝梢外侧，标本注记的口气
      const nameBoxes = []
      ctx.font = '600 11px "Noto Serif SC", Georgia, serif'
      for (const b of T.branches) {
        if (b.tb > tc) continue
        const x = X(b.tip[0] + b.side * 8)
        let y = Y(b.tip[1]) - 10
        const w = ctx.measureText(b.name).width
        // 撞上别的枝名就往下让一行
        for (let tries = 0; tries < 4 && nameBoxes.some(([bx, by2, bw]) => Math.abs(by2 - y) < 14 && Math.abs(bx - x) < (bw + w) / 2 + 6); tries++) y += 14
        nameBoxes.push([x, y, w])
        label(b.name, x, y, '600 11px "Noto Serif SC", Georgia, serif', inkSoft, 0.85 * Math.min(1, (tc - b.tb) / DAY / 10 + progress))
      }

      // 叶上的标题：拉近或选中时才出，挑重要的，避免叠字
      if (k >= LABEL_ZOOM || sel != null) {
        const cand = []
        for (const i of T.leaves) {
          const n = T.nodes[i]
          const x = X(n.x), y = Y(n.y)
          if (x < 0 || x > W || y < 0 || y > Hs) continue
          if (selSet && !selSet.has(i)) continue
          if (!selSet && k < LABEL_ZOOM) continue
          cand.push([i, (i === sel ? 1000 : 0) + (n.importance || 0) + (n.pinned ? 5 : 0)])
        }
        cand.sort((a, b) => b[1] - a[1])
        const taken = []
        ctx.font = '11px system-ui'
        for (const [i] of cand) {
          if (taken.length >= MAX_LABELS) break
          const n = T.nodes[i]
          const txt = String(n.title || '').slice(0, 16)
          const x = X(n.x) + 7, y = Y(n.y) + 4
          const w = ctx.measureText(txt).width
          if (taken.some(([a, b2, c]) => Math.abs(b2 - y) < 13 && x < a + c + 6 && a < x + w + 6)) continue
          taken.push([x, y, w])
          label(txt, x, y, '11px system-ui', i === sel ? ink : inkSoft, i === sel ? 1 : 0.75, 'left')
        }
      }
      ctx.globalAlpha = 1
      if (!intro.done) schedule()
    }

    function schedule() { if (!pending) pending = requestAnimationFrame(draw) }
    redrawRef.current = schedule
    resize()
    window.addEventListener('resize', resize)
    return () => { cancelAnimationFrame(pending); window.removeEventListener('resize', resize) }
  }, [theme])

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const pointers = new Map()
    let pinchDist = 0, moved = false, last = null
    const redraw = () => redrawRef.current()
    function hit(sx, sy) {
      const T = treeRef.current
      if (!T) return null
      const rect = el.getBoundingClientRect()
      const { tx, ty, k } = viewRef.current
      const cx = rect.width / 2 + tx, cy = rect.height / 2 + ty
      let best = null, bestD = 20 * 20
      for (const i of T.leaves) {
        const n = T.nodes[i]
        const d = (cx + n.x * k - sx) ** 2 + (cy + n.y * k - sy) ** 2
        if (d < bestD) { bestD = d; best = i }
      }
      return best
    }
    function onDown(e) {
      el.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      moved = false
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y) }
      last = { x: e.clientX, y: e.clientY }
    }
    function onMove(e) {
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchDist > 0) { const v = viewRef.current; v.k = Math.min(MAX_K, Math.max(MIN_K, v.k * (d / pinchDist))) }
        pinchDist = d; moved = true; redraw()
      } else if (last) {
        const dx = e.clientX - last.x, dy = e.clientY - last.y
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true
        viewRef.current.tx += dx; viewRef.current.ty += dy
        last = { x: e.clientX, y: e.clientY }
        redraw()
      }
    }
    function onUp(e) {
      pointers.delete(e.pointerId)
      pinchDist = 0
      if (!moved && pointers.size === 0) {
        const rect = el.getBoundingClientRect()
        const i = hit(e.clientX - rect.left, e.clientY - rect.top)
        selRef.current = i
        setSelected(i == null ? null : treeRef.current.nodes[i])
        redraw()
      }
      last = null
    }
    function onWheel(e) {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const v = viewRef.current
      const mx = e.clientX - rect.left - rect.width / 2
      const my = e.clientY - rect.top - rect.height / 2
      const nk = Math.min(MAX_K, Math.max(MIN_K, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
      v.tx = mx - (mx - v.tx) * (nk / v.k)
      v.ty = my - (my - v.ty) * (nk / v.k)
      v.k = nk
      redraw()
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  async function openDetail(node) {
    setDetailLoading(true)
    setDetail({ ...node, content: null })
    try { setDetail({ ...node, ...(await api.get(node.id)) }) }
    catch (err) { showToast('读取失败：' + err.message, 'error') }
    finally { setDetailLoading(false) }
  }

  return (
    <div className="vein-wrap">
      <canvas ref={canvasRef} className="vein-canvas" />
      <div className="vein-topbar">
        <h1>{IS_ZHAOHUA ? '记忆木牌树' : '记忆之树'}</h1>
        {stats && <span className="vein-stats">{stats.n} 片叶 · {stats.b} 根枝{IS_ZHAOHUA ? ` · ${stats.p} 块木牌` : ''}</span>}
        <div style={{ flex: 1 }} />
        <button className="vein-btn" onClick={fitView} title="看全貌"><Maximize2 size={15} /></button>
        <button className="vein-btn" onClick={load} title="刷新"><RefreshCw size={15} /></button>
        <button className="vein-btn" onClick={() => setMemoryView('list')} title="回列表视图"><List size={15} /></button>
      </div>
      {loading && <div className="vein-hint">{IS_ZHAOHUA ? '正在把重要记忆挂上枝头…' : '正在把记忆长成一棵树…'}</div>}
      {error && !loading && <div className="vein-hint">加载失败了：{error}</div>}
      {!loading && !error && !selected && <div className="vein-tip">{IS_ZHAOHUA ? '普通记忆成叶，重要记忆成牌' : '树干从下往上是时间，点一片叶看它牵着谁'}</div>}
      {selected && !detail && (
        <div className="vein-peek">
          <div className="vein-peek-head">
            <span className="vein-peek-type">{TYPE_LABELS[selected.type] || selected.type}</span>
            {selected.pinned && <Pin size={12} style={{ opacity: 0.6 }} />}
            <span className="vein-peek-meta">{(selected.created_at || '').slice(0, 10)}{selected.branch ? ` · ${selected.branch.name}` : ''} · 牵着 {selected.neighbors.length} 条</span>
            <div style={{ flex: 1 }} />
            <button className="vein-btn small" onClick={() => { selRef.current = null; setSelected(null); redrawRef.current() }}><X size={13} /></button>
          </div>
          <div className="vein-peek-title">{selected.title}</div>
          <button className="vein-peek-open" onClick={() => openDetail(selected)}>展开这条</button>
        </div>
      )}
      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal starmap-detail" onClick={(e) => e.stopPropagation()}>
            <div className="starmap-detail-head">
              <span className="vein-peek-type">{TYPE_LABELS[detail.type] || detail.type}</span>
              {detail.pinned && <Pin size={13} style={{ opacity: 0.6 }} />}
              <span className="starmap-detail-meta">{(detail.created_at || '').slice(0, 10)}</span>
              <div style={{ flex: 1 }} />
              <button className="vein-btn" onClick={() => setDetail(null)}><X size={15} /></button>
            </div>
            <div className="starmap-detail-body">{detailLoading && !detail.content ? '…' : (detail.content || detail.title)}</div>
            {detail.tags && <div className="starmap-detail-tags">{String(detail.tags).split(',').filter(Boolean).map((t) => <span key={t} className="tag">{t.trim()}</span>)}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
