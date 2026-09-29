import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { showToast } from './Toast'
import { List, RefreshCw, X, Pin, Maximize2 } from 'lucide-react'

// 记忆脉络（0929 原型，阿颖/涟言/曜在圆桌定的方向）
// 旧星图的问题：每条记忆都是同一种实心圆，一堆彩色小球飘着，像玩具。
// 这里换结构：语义相近的记忆聚成几簇，簇内按最小生成树长成叶脉，从中心往外长。
// 手机底线（曜提的三条）：不持续动画、不一次画全部标签、缩远时整簇合成一团。
// 布局是一次性确定性计算（无物理模拟），只在拖动/缩放/点选时重画一帧。

const TYPE_LABELS = {
  tech: '技术', memory: '记忆', dream: '梦境', diary: '日记',
  treasure: '宝藏', deep: '深层', anchor: '锚点',
}
// 低饱和：只让类型「有一点点不同」，主色交给主题的羽褐（--accent）
const TYPE_TINT = {
  memory: 0, tech: 205, dream: 280, diary: 345, treasure: 40, deep: 170, anchor: 15,
}

const MIN_K = 0.2, MAX_K = 5
const CLUSTER_ZOOM = 0.3      // 比这更远：整簇合成一团
const LABEL_ZOOM = 1.5         // 比这更近：才开始画记忆标题
const MAX_LABELS = 36
const INTRO_MS = 1100

function seeded(id, salt) {
  let h = (id * 2654435761 + salt * 40503) >>> 0
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// ── 聚簇：带权标签传播 → 再把小簇并进跟它连得最紧的邻簇，收成十来簇 ──
// 只跑标签传播会碎成近百簇（0929 实测 696 条 → 95 簇），满屏小团子又回到「玩具」的样子。
const MAX_CLUSTERS = 12
const MIN_CLUSTER = 10
function clusterNodes(nodes, adj) {
  const label = nodes.map((_, i) => i)
  const order = nodes.map((_, i) => i).sort((a, b) => nodes[a].id - nodes[b].id)
  for (let iter = 0; iter < 20; iter++) {
    let changed = 0
    for (const i of order) {
      if (!adj[i].length) continue
      const score = new Map()
      for (const [j, s] of adj[i]) score.set(label[j], (score.get(label[j]) || 0) + s)
      let best = label[i], bestS = score.get(label[i]) || 0
      for (const [l, s] of score) if (s > bestS + 1e-9 || (Math.abs(s - bestS) < 1e-9 && l < best)) { best = l; bestS = s }
      if (best !== label[i]) { label[i] = best; changed++ }
    }
    if (!changed) break
  }
  const groups = new Map()
  label.forEach((l, i) => { if (!groups.has(l)) groups.set(l, new Set()); groups.get(l).add(i) })
  const loose = []
  for (const [l, set] of groups) {
    if (set.size === 1 && !adj[[...set][0]].length) { loose.push(...set); groups.delete(l) }
  }
  const of = new Map()
  for (const [l, set] of groups) for (const i of set) of.set(i, l)
  const link = (a, b) => {
    let w = 0
    for (const i of groups.get(a)) for (const [j, s] of adj[i]) if (of.get(j) === b) w += s
    return w
  }
  while (groups.size > 1) {
    let small = null
    for (const [l, set] of groups) if (!small || set.size < groups.get(small).size) small = l
    if (groups.size <= MAX_CLUSTERS && groups.get(small).size >= MIN_CLUSTER) break
    const neigh = new Set()
    for (const i of groups.get(small)) for (const [j] of adj[i]) if (of.get(j) !== small) neigh.add(of.get(j))
    let target = null, tw = 0
    for (const d of neigh) { const w = link(small, d) / Math.sqrt(groups.get(d).size); if (w > tw) { tw = w; target = d } }
    const set = groups.get(small)
    groups.delete(small)
    if (target == null) { loose.push(...set); for (const i of set) of.delete(i); continue }
    for (const i of set) { groups.get(target).add(i); of.set(i, target) }
  }
  const clusters = [...groups.values()].map((set) => [...set]).sort((a, b) => b.length - a.length)
  if (loose.length) clusters.push(loose)
  return { clusters, looseIndex: loose.length ? clusters.length - 1 : -1 }
}

// 簇名：挑「这一簇里多、别处少」的标签（言叽这种到处都有的标签不会当名字），且不重名
function nameClusters(clusters, nodes, looseIndex) {
  const tagsOf = (i) => String(nodes[i].tags || '').split(/[,，]/).map((t) => t.trim()).filter((t) => t && t.length <= 8)
  const global = new Map()
  for (let i = 0; i < nodes.length; i++) for (const t of tagsOf(i)) global.set(t, (global.get(t) || 0) + 1)
  const used = new Set()
  return clusters.map((members, ci) => {
    if (ci === looseIndex) return '零散'
    const count = new Map()
    for (const i of members) for (const t of tagsOf(i)) count.set(t, (count.get(t) || 0) + 1)
    const ranked = [...count].filter(([, c]) => c >= 2)
      .map(([t, c]) => [t, c * Math.log(nodes.length / global.get(t))])
      .sort((a, b) => b[1] - a[1])
    const pick = ranked.find(([t]) => !used.has(t))
    if (pick) { used.add(pick[0]); return pick[0] }
    const top = members.reduce((a, b) => ((nodes[b].importance || 0) > (nodes[a].importance || 0) ? b : a))
    return String(nodes[top].title || '').replace(/[#*`【】\[\]]/g, '').slice(0, 6) || '一簇'
  })
}

// ── 簇内的枝：从根出发按「跳数」一层层长（BFS），每个节点挂到上一层里跟它最像的那个。
// 纯最小生成树会拉出很长的单链（0929 第二版实测），BFS 树更矮更茂，像叶脉。
function spanningTree(members, nodes, adj) {
  const inSet = new Set(members)
  const root = members.reduce((a, b) => {
    const sa = (nodes[a].pinned ? 100 : 0) + (nodes[a].importance || 0)
    const sb = (nodes[b].pinned ? 100 : 0) + (nodes[b].importance || 0)
    return sb > sa || (sb === sa && nodes[b].id < nodes[a].id) ? b : a
  })
  const parent = new Map([[root, -1]])
  const sim = new Map([[root, 1]])
  let level = [root]
  while (level.length) {
    const next = new Map()   // child → [parent, s]
    for (const p of level) {
      for (const [j, s] of adj[p]) {
        if (!inSet.has(j) || parent.has(j)) continue
        const cur = next.get(j)
        if (!cur || s > cur[1]) next.set(j, [p, s])
      }
    }
    for (const [c, [p, s]] of next) { parent.set(c, p); sim.set(c, s) }
    level = [...next.keys()]
  }
  // 簇里够不着的（零散簇基本都是）：直接挂在根上
  for (const m of members) if (!parent.has(m)) { parent.set(m, root); sim.set(m, 0) }
  const children = new Map(members.map((m) => [m, []]))
  for (const [c, p] of parent) if (p >= 0) children.get(p).push(c)
  for (const list of children.values()) list.sort((a, b) => (nodes[b].importance || 0) - (nodes[a].importance || 0) || nodes[a].id - nodes[b].id)
  return { root, parent, children, sim }
}

// ── 叶脉式生长：子节点从父节点往外伸，不是按同心圆排；子树越大分到的角度越宽 ──
// （0929 第一版按同心圆排，扇面大的簇会拉出很长的弧线，不像叶脉）
function layoutTree(tree, cx, cy, outAngle, spread, step, pos, depthOf) {
  const size = new Map()
  const measure = (i) => { let s = 1; for (const c of tree.children.get(i)) s += measure(c); size.set(i, s); return s }
  measure(tree.root)
  pos.set(tree.root, [cx, cy]); depthOf.set(tree.root, 0)
  const place = (i, a0, a1, depth) => {
    const kids = tree.children.get(i)
    if (!kids.length) return
    const [px, py] = pos.get(i)
    const total = kids.reduce((s, c) => s + size.get(c), 0)
    let a = a0
    for (const c of kids) {
      const span = (a1 - a0) * size.get(c) / total
      const mid = a + span / 2 + (seeded(c + 1, 9) - 0.5) * span * 0.25
      // 越往外越短，末梢收细；大子树多伸一点给后代留地方
      const len = step * Math.max(0.55, 1 - depth * 0.07) * (0.85 + Math.min(0.9, Math.sqrt(size.get(c)) * 0.12)) * (0.9 + seeded(c + 1, 7) * 0.2)
      pos.set(c, [px + Math.cos(mid) * len, py + Math.sin(mid) * len])
      depthOf.set(c, depth + 1)
      // 往下一层，扇面向中线收拢一些，枝条才会往一个方向长
      const narrow = Math.min(span, Math.PI * 0.9) * 0.5
      place(c, Math.max(a, mid - narrow), Math.min(a + span, mid + narrow), depth + 1)
      a += span
    }
  }
  place(tree.root, outAngle - spread / 2, outAngle + spread / 2, 0)
}

function buildLayout(g, aspect = 1) {
  const idx = new Map()
  const nodes = g.nodes.map((n, i) => { idx.set(n.id, i); return { ...n } })
  const adj = nodes.map(() => [])
  const edges = []
  for (const [a, b, s] of g.edges || []) {
    const i = idx.get(a), j = idx.get(b)
    if (i == null || j == null) continue
    adj[i].push([j, s]); adj[j].push([i, s])
    edges.push({ a: i, b: j, s })
  }
  const { clusters, looseIndex } = clusterNodes(nodes, adj)
  const names = nameClusters(clusters, nodes, looseIndex)
  const pos = new Map(), depthOf = new Map()
  const treeEdges = []
  const clusterInfo = []
  // 簇的摆放（第二版，0929 阿颖说「太空旷」）：十二丛各长各的像孤岛，所以改成一棵整体——
  // 中心一个根「我们」，每簇按大小分到一段角度，主干从中心伸到簇根，再在那段角度里分枝。
  const total = clusters.reduce((s, m) => s + m.length, 0)
  let acc = -Math.PI / 2
  let ring = 0
  clusters.forEach((members, ci) => {
    const isLoose = ci === looseIndex
    const share = (Math.PI * 2) * members.length / total
    const ang = acc + share / 2
    acc += share
    const tree = spanningTree(members, nodes, adj)
    const spread = Math.max(0.5, Math.min(share * 0.92, Math.PI * 0.9))
    const step = isLoose ? 20 : 24 + Math.min(10, Math.sqrt(members.length))
    // 小簇离中心近一点、大簇远一点，主干长短不一才不像轮辐
    const trunk = 70 + Math.sqrt(members.length) * 9 + seeded(ci + 5, 13) * 30
    const rx = Math.cos(ang) * trunk, ry = Math.sin(ang) * trunk
    layoutTree(tree, rx, ry, ang, spread, step, pos, depthOf)
    for (const [c, p] of tree.parent) if (p >= 0) treeEdges.push({ a: p, b: c, s: tree.sim.get(c), depth: depthOf.get(c) })
    let sx = 0, sy = 0, r = 0
    for (const m of members) { const [x, y] = pos.get(m); sx += x; sy += y; nodes[m].cluster = ci }
    sx /= members.length; sy /= members.length
    for (const m of members) { const [x, y] = pos.get(m); r = Math.max(r, Math.hypot(x - sx, y - sy)); ring = Math.max(ring, Math.hypot(x, y)) }
    let far = 0
    for (const m of members) { const [x, y] = pos.get(m); far = Math.max(far, x * Math.cos(ang) + y * Math.sin(ang)) }
    clusterInfo.push({ members, name: names[ci], x: sx, y: sy, r, loose: isLoose, rootX: rx, rootY: ry, angle: ang, trunk,
      tipX: Math.cos(ang) * (far + 22), tipY: Math.sin(ang) * (far + 22) })
  })
  // 竖屏把整株往上下拉开一点，别让一个圆挤在宽度里、上下留两大片白（曜：自适应收紧画幅）
  for (const [i, [x, y]] of pos) pos.set(i, [x, y * aspect])
  for (const c of clusterInfo) { c.y *= aspect; c.rootY *= aspect; c.tipY = c.tipY * aspect }
  nodes.forEach((n, i) => {
    const [x, y] = pos.get(i) || [0, 0]
    n.x = x; n.y = y; n.depth = depthOf.get(i) || 0; n.neighbors = adj[i]
  })
  const maxDepth = Math.max(1, ...treeEdges.map((e) => e.depth))
  // 串门线：跨簇的语义相近，画得很淡，给空白一点经络
  const crossEdges = edges.filter((e) => nodes[e.a].cluster !== nodes[e.b].cluster)
  return { nodes, edges, treeEdges, crossEdges, clusters: clusterInfo, extent: ring, maxDepth }
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export default function MemoryVeinPanel() {
  const setMemoryView = useStore((s) => s.setMemoryView)
  const theme = useStore((s) => s.theme)
  const canvasRef = useRef(null)
  const layoutRef = useRef(null)
  const viewRef = useRef({ tx: 0, ty: 0, k: 1 })
  const selRef = useRef(null)
  const introRef = useRef({ start: 0, done: false })
  const redrawRef = useRef(() => {})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stats, setStats] = useState(null)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const fitView = useCallback(() => {
    const L = layoutRef.current, c = canvasRef.current
    if (!L || !c) return
    const rect = c.getBoundingClientRect()
    // 按实际外包框居中，别按离原点最远的那条算——不然一半屏幕是空的
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const n of L.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y) }
    // 簇名写在梢外，也要框进来，不然贴边的名字会被切掉
    for (const c of L.clusters) { x0 = Math.min(x0, c.tipX - 30); x1 = Math.max(x1, c.tipX + 30); y0 = Math.min(y0, c.tipY - 12); y1 = Math.max(y1, c.tipY + 18) }
    const top = 76, bottom = 110
    const k = Math.max(MIN_K, Math.min(1.2, (rect.width - 32) / (x1 - x0 + 40), (rect.height - top - bottom) / (y1 - y0 + 40)))
    viewRef.current = { tx: -((x0 + x1) / 2) * k, ty: -((y0 + y1) / 2) * k + (top - bottom) / 2, k }
    redrawRef.current()
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const g = await api.graph()
      const rect = canvasRef.current?.getBoundingClientRect()
      const aspect = rect && rect.width > 0 ? Math.max(1, Math.min(1.6, (rect.height - 190) / rect.width)) : 1
      const L = buildLayout(g, aspect)
      layoutRef.current = L
      selRef.current = null; setSelected(null)
      setStats({ n: L.nodes.length, c: L.clusters.filter((c) => !c.loose).length })
      introRef.current = { start: 0, done: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches }
      requestAnimationFrame(fitView)
    } catch (e) {
      setError(e.message)
      showToast('脉络加载失败：' + e.message, 'error')
    } finally { setLoading(false) }
  }, [fitView])

  useEffect(() => { load() }, [load])

  // ── 绘制：按需一帧，不常驻循环 ──
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
      const W = rect.width, H = rect.height
      const bg = cssVar('--bg', '#ECEEF4')
      const ink = cssVar('--ink', '#1C2130')
      const inkSoft = cssVar('--ink-soft', '#5A6070')
      const vein = cssVar('--accent', '#A07850')
      const dark = theme === 'midnight'

      ctx.globalAlpha = 1
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)
      const L = layoutRef.current
      if (!L || !L.nodes.length) return

      const intro = introRef.current
      if (!intro.done && !intro.start) intro.start = t
      const progress = intro.done ? 1 : Math.min(1, (t - intro.start) / INTRO_MS)
      if (progress >= 1) intro.done = true

      const { tx, ty, k } = viewRef.current
      const cx = W / 2 + tx, cy = H / 2 + ty
      const X = (x) => cx + x * k, Y = (y) => cy + y * k
      const sel = selRef.current
      const selSet = sel != null ? new Set([sel, ...L.nodes[sel].neighbors.map(([j]) => j)]) : null
      const off = (x, y, m = 40) => x < -m || x > W + m || y < -m || y > H + m

      // 文字底下垫一圈底色描边，压在枝条上也读得清
      const label = (text, x, y, font, color, alpha) => {
        ctx.font = font; ctx.textAlign = 'center'
        ctx.globalAlpha = alpha
        ctx.lineWidth = 4; ctx.strokeStyle = bg; ctx.lineJoin = 'round'
        ctx.strokeText(text, x, y)
        ctx.fillStyle = color; ctx.fillText(text, x, y)
        ctx.textAlign = 'left'
      }
      // 中心根「我们」+ 主干：从中心弯弯地伸到每簇的根，越往外越细
      const drawTrunks = () => {
        ctx.lineCap = 'round'
        ctx.strokeStyle = vein
        for (const c of L.clusters) {
          const grow = Math.min(1, progress * 3)
          const ex = X(c.rootX * grow), ey = Y(c.rootY * grow)
          const bend = (seeded(c.members.length + 17, 21) - 0.5) * 0.4
          const mx = (X(0) + ex) / 2 - (ey - Y(0)) * bend, my = (Y(0) + ey) / 2 + (ex - X(0)) * bend
          ctx.globalAlpha = c.loose ? 0.18 : 0.42
          ctx.lineWidth = Math.max(1, (c.loose ? 1.2 : 1.6 + Math.sqrt(c.members.length) * 0.22) * Math.sqrt(Math.max(k, 0.3)))
          ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke()
        }
        ctx.globalAlpha = 0.9 * progress
        ctx.fillStyle = vein
        ctx.beginPath(); ctx.arc(X(0), Y(0), Math.max(3, 4 * Math.sqrt(k)), 0, Math.PI * 2); ctx.fill()
      }
      const drawCenterLabel = () => label('我 们', X(0), Y(0) - 12, '600 13px system-ui', ink, 0.9 * progress)
      const drawCross = (alpha) => {
        if (progress < 1 || sel != null) return
        ctx.strokeStyle = vein
        ctx.lineWidth = 0.5
        for (const e of L.crossEdges) {
          const a = L.nodes[e.a], b = L.nodes[e.b]
          ctx.globalAlpha = alpha * (0.4 + e.s)
          ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke()
        }
      }

      // 缩远：不画点、不画标题，只留每簇的主干（前三层枝）和簇名——远看是几丛叶脉，不是一堆泡泡
      if (k < CLUSTER_ZOOM) {
        drawCross(0.05)
        drawTrunks()
        ctx.lineCap = 'round'
        ctx.strokeStyle = vein
        for (const e of L.treeEdges) {
          const grow = Math.min(1, Math.max(0, progress * (L.maxDepth + 1) - (e.depth - 1)))
          if (grow <= 0) continue
          const a = L.nodes[e.a], b = L.nodes[e.b]
          const ax = X(a.x), ay = Y(a.y)
          const bx = ax + (X(b.x) - ax) * grow, by = ay + (Y(b.y) - ay) * grow
          ctx.globalAlpha = Math.max(0.14, 0.5 - e.depth * 0.08)
          ctx.lineWidth = Math.max(0.45, 1.5 - e.depth * 0.25)
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
        }
        for (const c of L.clusters) {
          const x = X(c.tipX), y = Y(c.tipY) + 4
          label(c.name, x, y, '600 12px system-ui', ink, (c.loose ? 0.4 : 0.85) * progress)
          label(String(c.members.length), x, y + 13, '10px system-ui', inkSoft, 0.5 * progress)
        }
        drawCenterLabel()
        ctx.textAlign = 'left'; ctx.globalAlpha = 1
        if (!intro.done) schedule()
        return
      }

      drawCross(0.07)
      drawTrunks()
      // 叶脉：只画生成树的枝；靠根的粗，末梢细；开场按深度从里往外长一次
      ctx.lineCap = 'round'
      ctx.strokeStyle = vein
      for (const e of L.treeEdges) {
        const grow = Math.min(1, Math.max(0, progress * (L.maxDepth + 1) - (e.depth - 1)))
        if (grow <= 0) continue
        const a = L.nodes[e.a], b = L.nodes[e.b]
        const ax = X(a.x), ay = Y(a.y), bx = X(b.x), by = Y(b.y)
        if (off(ax, ay, 200) && off(bx, by, 200)) continue
        const ex = ax + (bx - ax) * grow, ey = ay + (by - ay) * grow
        // 轻微弯曲：控制点向垂直方向偏一点，像叶脉而不是直尺画的线
        const bend = (seeded(e.b + 3, 11) - 0.5) * 0.35
        const mx = (ax + ex) / 2 - (ey - ay) * bend, my = (ay + ey) / 2 + (ex - ax) * bend
        const w = Math.max(0.5, (2.3 - e.depth * 0.32)) * Math.sqrt(k)
        const dim = selSet && !(selSet.has(e.a) && selSet.has(e.b))
        ctx.globalAlpha = (dim ? 0.08 : 0.22 + (e.s || 0) * 0.35) * (dark ? 1.15 : 1)
        ctx.lineWidth = w
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke()
      }

      // 选中时：把它所有语义邻居（含跨簇的）用细虚线牵出来
      if (sel != null && progress >= 1) {
        const p = L.nodes[sel]
        ctx.setLineDash([3, 4])
        ctx.lineWidth = Math.max(0.6, 0.9 * Math.sqrt(k))
        for (const [j, s] of p.neighbors) {
          const q = L.nodes[j]
          ctx.globalAlpha = 0.25 + s * 0.5
          ctx.strokeStyle = ink
          ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(X(q.x), Y(q.y)); ctx.stroke()
        }
        ctx.setLineDash([])
      }

      // 节点：很小的实点，置顶的是空心环；类型只轻轻偏一点色相
      for (let i = 0; i < L.nodes.length; i++) {
        const p = L.nodes[i]
        const reveal = Math.min(1, Math.max(0, progress * (L.maxDepth + 1) - p.depth + 0.4))
        if (reveal <= 0) continue
        const x = X(p.x), y = Y(p.y)
        if (off(x, y)) continue
        const r = (1.1 + (p.importance || 5) * 0.2) * Math.sqrt(k) * (i === sel ? 1.8 : 1)
        const dim = selSet && !selSet.has(i)
        const hue = TYPE_TINT[p.type] ?? 30
        const light = dark ? 72 : 34
        ctx.globalAlpha = (dim ? 0.15 : 0.62 + Math.min(0.3, (p.importance || 5) * 0.03)) * reveal
        const color = p.type === 'memory' ? inkSoft : `hsl(${hue} 20% ${light + 6}%)`
        if (p.pinned) {
          ctx.strokeStyle = color; ctx.lineWidth = 1.2
          ctx.beginPath(); ctx.arc(x, y, r + 1.4, 0, Math.PI * 2); ctx.stroke()
        } else {
          ctx.fillStyle = color
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
        }
      }

      // 簇名：写在每丛的梢外，不和中心挤在一起
      for (const c of L.clusters) {
        const x = X(c.tipX), y = Y(c.tipY) + 4
        if (off(x, y)) continue
        label(c.name.split('').join(' '), x, y, '600 11px system-ui', inkSoft, (c.loose ? 0.35 : 0.8) * progress)
      }
      drawCenterLabel()

      // 记忆标题：只在拉近以后、只挑视口里最重要的几条
      if (k >= LABEL_ZOOM || sel != null) {
        const cand = []
        for (let i = 0; i < L.nodes.length; i++) {
          const p = L.nodes[i]
          const x = X(p.x), y = Y(p.y)
          if (off(x, y, 0)) continue
          if (selSet && !selSet.has(i)) continue
          if (!selSet && k < LABEL_ZOOM) continue
          cand.push([i, (i === sel ? 1000 : 0) + (p.importance || 0) + (p.pinned ? 5 : 0)])
        }
        cand.sort((a, b) => b[1] - a[1])
        ctx.font = '11px system-ui'
        const taken = []
        for (const [i] of cand.slice(0, MAX_LABELS * 2)) {
          if (taken.length >= MAX_LABELS) break
          const p = L.nodes[i]
          const x = X(p.x) + 6, y = Y(p.y) + 4
          const label = String(p.title || '').slice(0, 16)
          const w = ctx.measureText(label).width
          if (taken.some(([tx2, ty2, tw]) => Math.abs(ty2 - y) < 13 && x < tx2 + tw + 6 && tx2 < x + w + 6)) continue
          taken.push([x, y, w])
          ctx.globalAlpha = i === sel ? 1 : 0.7
          ctx.fillStyle = i === sel ? ink : inkSoft
          ctx.fillText(label, x, y)
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

  // ── 交互：拖动 / 双指缩放 / 滚轮 / 点选 ──
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const pointers = new Map()
    let pinchDist = 0, moved = false, last = null

    function hit(sx, sy) {
      const L = layoutRef.current
      if (!L) return null
      const rect = el.getBoundingClientRect()
      const { tx, ty, k } = viewRef.current
      if (k < CLUSTER_ZOOM) return null
      const cx = rect.width / 2 + tx, cy = rect.height / 2 + ty
      let best = null, bestD = 20 * 20
      for (let i = 0; i < L.nodes.length; i++) {
        const d = (cx + L.nodes[i].x * k - sx) ** 2 + (cy + L.nodes[i].y * k - sy) ** 2
        if (d < bestD) { bestD = d; best = i }
      }
      return best
    }
    function hitCluster(sx, sy) {
      const L = layoutRef.current
      if (!L) return null
      const rect = el.getBoundingClientRect()
      const { tx, ty, k } = viewRef.current
      const cx = rect.width / 2 + tx, cy = rect.height / 2 + ty
      for (const c of L.clusters) {
        const r = Math.max(14, (c.r + 18) * k)
        if ((cx + c.x * k - sx) ** 2 + (cy + c.y * k - sy) ** 2 < r * r) return c
      }
      return null
    }
    const redraw = () => redrawRef.current()

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
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top
        const v = viewRef.current
        if (v.k < CLUSTER_ZOOM) {
          // 缩远时点一团：拉近到那一簇
          const c = hitCluster(sx, sy)
          if (c) { v.k = 1.1; v.tx = -c.x * v.k; v.ty = -c.y * v.k; redraw() }
        } else {
          const i = hit(sx, sy)
          selRef.current = i
          setSelected(i == null ? null : layoutRef.current.nodes[i])
          redraw()
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
        <h1>记忆脉络</h1>
        {stats && <span className="vein-stats">{stats.n} 条 · {stats.c} 簇</span>}
        <div style={{ flex: 1 }} />
        <button className="vein-btn" onClick={fitView} title="看全貌"><Maximize2 size={15} /></button>
        <button className="vein-btn" onClick={load} title="刷新"><RefreshCw size={15} /></button>
        <button className="vein-btn" onClick={() => setMemoryView('list')} title="回列表视图"><List size={15} /></button>
      </div>

      {loading && <div className="vein-hint">正在把记忆理成脉络…</div>}
      {error && !loading && <div className="vein-hint">加载失败了：{error}</div>}
      {!loading && !error && !selected && <div className="vein-tip">拉近看标题，点一条看它牵着谁</div>}

      {selected && !detail && (
        <div className="vein-peek">
          <div className="vein-peek-head">
            <span className="vein-peek-type">{TYPE_LABELS[selected.type] || selected.type}</span>
            {selected.pinned && <Pin size={12} style={{ opacity: 0.6 }} />}
            <span className="vein-peek-meta">{(selected.created_at || '').slice(0, 10)} · 牵着 {selected.neighbors.length} 条</span>
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

export { buildLayout, clusterNodes, nameClusters, seeded, TYPE_LABELS, TYPE_TINT }
