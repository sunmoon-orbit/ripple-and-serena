// 归巢开屏（0928）：起雾的玻璃，后面是乌鸦和蜂鸟。见 splash.css 顶部说明。
// 旧版（9/10 撤掉的 roost-splash）的教训：雾只是一层渐变、擦除用 shadowBlur（手机很吃力）、
// 水波是几个放大的圆圈——看着假还可能卡。这版：雾有颗粒和水珠，擦除用径向渐变笔刷
// （destination-out，不用 shadowBlur），回雾是每隔几帧叠一层低透明度的雾；水波画在玻璃上，
// 后面的两只鸟按距离跟着晃。一天只出现一次（本机日期），?splash=1 强制显示方便看效果。
(function () {
  const KEY = 'raven-splash-day'
  const force = /[?&]splash=1\b/.test(location.search)
  const today = new Date().toLocaleDateString('en-CA')
  try { if (!force && localStorage.getItem(KEY) === today) return } catch { /* 读不到就照常显示 */ }

  const SCENE = `<svg class="sp-scene" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <defs>
    <linearGradient id="cr-feather" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a2f3d"/><stop offset="0.55" stop-color="#15171f"/><stop offset="1" stop-color="#0c0d12"/>
    </linearGradient>
    <linearGradient id="cr-sheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4b5a8c" stop-opacity="0"/><stop offset="0.5" stop-color="#5d6fa8" stop-opacity=".55"/><stop offset="1" stop-color="#7b5ea0" stop-opacity="0"/>
    </linearGradient>
<linearGradient id="hb-body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d98a3d"/><stop offset="1" stop-color="#b8662a"/>
    </linearGradient>
    <linearGradient id="hb-gorget" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff7a45"/><stop offset="0.5" stop-color="#e8452c"/><stop offset="1" stop-color="#f2a33a"/>
    </linearGradient>
    <linearGradient id="hb-wing" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#6d5a4c"/><stop offset="1" stop-color="#9b8676"/>
    </linearGradient>
  </defs>
  <!-- 共用的一根树枝：跟两张新头像同款 -->
  <path class="sp-branch" d="M-20 196 C 90 182, 200 196, 300 186 S 390 180, 430 176" stroke="#4a3a2e" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M318 184 q 16 -16 34 -14" stroke="#4a3a2e" stroke-width="4" fill="none" stroke-linecap="round"/>
  <ellipse cx="350" cy="168" rx="10" ry="5.5" fill="#7f9e6c" transform="rotate(-20 350 168)"/>
  <g class="sp-bird sp-crow"><g class="sp-swayer"><g class="sp-lean"><g transform="translate(55 57) scale(0.9)">
    <g >
  <g transform="translate(200 0) scale(-1 1)">
    <path d="M126 128 L 168 164 L 160 146 L 176 150 Z" fill="#101218"/>
    <ellipse cx="108" cy="108" rx="38" ry="30" fill="url(#cr-feather)" transform="rotate(-22 108 108)"/>
    <path d="M104 88 C 142 84, 164 108, 158 132 C 138 130, 116 118, 100 104 Z" fill="#191c26"/>
    <path d="M112 96 C 134 96, 150 110, 152 124" stroke="url(#cr-sheen)" stroke-width="5" fill="none" stroke-linecap="round"/>
    <circle cx="78" cy="78" r="21" fill="url(#cr-feather)"/>
    <path d="M66 66 C 76 60, 90 62, 96 70" stroke="url(#cr-sheen)" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M60 78 C 50 78, 38 82, 32 88 C 42 88, 54 88, 62 86 Z" fill="#20222a"/>
    <path d="M60 78 C 52 79, 42 83, 36 86" stroke="#3a3e4a" stroke-width="1.2" fill="none"/>
    <circle cx="76" cy="74" r="5.2" fill="#6a7384"/>
    <circle cx="76" cy="74" r="4.2" fill="#2b1e14"/>
    <circle cx="77.4" cy="72.6" r="1.4" fill="#e9eef5"/>
    <path d="M102 134 L 100 147 M116 132 L 116 145" stroke="#1a1c22" stroke-width="3" stroke-linecap="round"/>
    <path d="M94 148 q 6 -4 12 0 M110 146 q 6 -4 12 0" stroke="#1a1c22" stroke-width="2.6" fill="none" stroke-linecap="round"/>
  </g>
  </g>
  </g></g></g></g>
  <g class="sp-bird sp-hb"><g class="sp-swayer"><g class="sp-lean"><g transform="translate(190 62) scale(0.9)">
    <g >
    <path d="M118 128 L 150 156 L 142 138 L 158 146 Z" fill="#c1702e"/>
    <path d="M110 92 C 140 90, 156 110, 150 126 C 136 124, 118 116, 106 106 Z" fill="url(#hb-wing)"/>
    <ellipse cx="104" cy="108" rx="30" ry="24" fill="url(#hb-body)" transform="rotate(-18 104 108)"/>
    <path d="M80 96 C 82 108, 94 114, 104 110 C 96 106, 88 100, 86 94 Z" fill="#fbf4ea"/>
    <circle cx="82" cy="82" r="17" fill="#c9772f"/>
    <path d="M70 90 C 74 102, 88 106, 96 98 C 88 96, 80 92, 76 86 Z" fill="url(#hb-gorget)"/>
    <path d="M67 78 L 34 72 L 67 83 Z" fill="#2b2320"/>
    <circle cx="79" cy="78" r="3.6" fill="#1d1715"/>
    <circle cx="80.2" cy="76.8" r="1.1" fill="#fff"/>
    <path d="M100 129 L 98 140 M110 128 L 110 139" stroke="#3a2d26" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M94 141 q 4 -3 8 0 M106 140 q 4 -3 8 0" stroke="#3a2d26" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  </g>
  </g></g></g></g>
</svg>`
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches

  const ov = document.createElement('div')
  ov.id = 'sp-overlay'
  ov.innerHTML = `<div class="sp-glow"></div>${SCENE}<canvas id="sp-fog"></canvas><canvas id="sp-waves"></canvas>
    <div class="sp-title"><b>Ripple &amp; Serena</b><span>归巢</span></div>
    <div class="sp-hint">用手指擦开雾气</div>
    <button class="sp-enter" type="button">进 入</button>
    <button class="sp-skip" type="button">跳过</button>`
  document.body.appendChild(ov)

  const canvas = ov.querySelector('#sp-fog')
  const ctx = canvas.getContext('2d')
  // 水波单独一层、每帧清空重画：画进雾层会一圈圈刻成唱片纹（0928 第一版就这样）
  const wcv = ov.querySelector('#sp-waves'), wctx = wcv.getContext('2d')
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)   // 上限 1.5：画面够细，又不把手机 GPU 压垮
  let W = 0, H = 0, fogTex = null, raf = 0, frame = 0, alive = true, revealed = false
  const ripples = []

  function makeFogTexture() {
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const g = c.getContext('2d')
    const grad = g.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, 'rgba(206,218,232,.86)'); grad.addColorStop(1, 'rgba(176,192,212,.9)')
    g.fillStyle = grad; g.fillRect(0, 0, W, H)
    // 雾的颗粒：一堆很淡的小团，让它不是一块平的颜色
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * W, y = Math.random() * H, r = (Math.random() * 18 + 4) * dpr
      g.fillStyle = `rgba(255,255,255,${Math.random() * .06})`
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill()
    }
    // 水珠：暗边 + 高光，偶尔拖一道往下流的水痕
    for (let i = 0; i < 140; i++) {
      const x = Math.random() * W, y = Math.random() * H, r = (Math.random() * 3.2 + .8) * dpr
      g.fillStyle = 'rgba(70,90,115,.35)'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill()
      g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.arc(x - r * .3, y - r * .35, r * .38, 0, 7); g.fill()
      if (Math.random() < .08) {
        g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = r * .9
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - .5) * 6 * dpr, y + (Math.random() * 60 + 20) * dpr); g.stroke()
      }
    }
    return c
  }

  function resize() {
    W = Math.round(innerWidth * dpr); H = Math.round(innerHeight * dpr)
    canvas.width = W; canvas.height = H
    wcv.width = W; wcv.height = H
    fogTex = makeFogTexture()
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(fogTex, 0, 0)
  }

  // 擦除笔刷：径向渐变，中心全透、边缘柔和（替代旧版的 shadowBlur）
  function wipe(x, y, r) {
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(.6, 'rgba(0,0,0,.85)'); g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
    ctx.restore()
  }

  let last = null
  function pt(e) { const t = e.touches ? e.touches[0] : e; return { x: t.clientX * dpr, y: t.clientY * dpr } }
  function onDown(e) {
    if (e.target.closest('button')) return
    last = pt(e); wipe(last.x, last.y, 34 * dpr); ripple(last)
  }
  function onMove(e) {
    if (!last) return
    const p = pt(e), dx = p.x - last.x, dy = p.y - last.y, d = Math.hypot(dx, dy), step = 10 * dpr
    for (let s = step; s <= d; s += step) wipe(last.x + dx * s / d, last.y + dy * s / d, 34 * dpr)
    if (d >= step) last = p
    e.preventDefault()
  }
  function onUp() { last = null }

  function ripple(p) {
    ripples.push({ x: p.x, y: p.y, t: 0 })
    // 两只鸟按离点击处的远近跟着晃
    // 晃动挂在 .sp-swayer 这一层，不能挂在 .sp-bird 上：.sp-bird 带着飞入动画，
    // 摘掉晃动 class 时浏览器会把飞入动画从头再播一遍，两只鸟就凭空消失又飞回来（0928 测出来的）
    ov.querySelectorAll('.sp-swayer').forEach((b) => {
      const r = b.getBoundingClientRect()
      const bx = (r.left + r.width / 2) * dpr, by = (r.top + r.height / 2) * dpr
      const dist = Math.hypot(bx - p.x, by - p.y) / dpr
      const k = Math.max(.25, 1 - dist / 500), dir = bx >= p.x ? 1 : -1
      b.style.setProperty('--sw', (dir * 6 * k).toFixed(1) + 'px')
      b.style.setProperty('--swr', (dir * 4 * k).toFixed(1) + 'deg')
      b.classList.remove('sp-sway'); void b.getBoundingClientRect(); b.classList.add('sp-sway')
      b.style.animationDelay = Math.min(.35, dist / 1400) + 's'
      setTimeout(() => { b.classList.remove('sp-sway'); b.style.animationDelay = '' }, 1400)
    })
  }

  function drawRipples() {
    wctx.clearRect(0, 0, W, H)
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i]; rp.t += 1
      const life = 80, a = 1 - rp.t / life
      if (a <= 0) { ripples.splice(i, 1); continue }
      for (let k = 0; k < 3; k++) {
        const rad = (rp.t * 2.4 - k * 22) * dpr
        if (rad <= 0) continue
        const fade = a * (1 - k * .28)
        // 一道暗、一道亮，错开一点点，像水面的起伏
        wctx.strokeStyle = `rgba(20,35,55,${(.16 * fade).toFixed(3)})`; wctx.lineWidth = 3 * dpr
        wctx.beginPath(); wctx.arc(rp.x, rp.y + 1.5 * dpr, rad, 0, 7); wctx.stroke()
        wctx.strokeStyle = `rgba(255,255,255,${(.35 * fade).toFixed(3)})`; wctx.lineWidth = 1.6 * dpr
        wctx.beginPath(); wctx.arc(rp.x, rp.y - 1 * dpr, rad, 0, 7); wctx.stroke()
      }
    }
  }

  function clearedRatio() {
    // 粗采样 24×40 个点，看多少雾被擦掉了
    let clear = 0, n = 0
    for (let gy = 0; gy < 40; gy++) for (let gx = 0; gx < 24; gx++) {
      const a = ctx.getImageData(Math.floor((gx + .5) * W / 24), Math.floor((gy + .5) * H / 40), 1, 1).data[3]
      n++; if (a < 90) clear++
    }
    return clear / n
  }

  function reveal() {
    if (revealed) return
    revealed = true
    ov.querySelector('.sp-title').classList.add('sp-show')
    ov.querySelector('.sp-enter').classList.add('sp-show')
  }

  function tick() {
    if (!alive) return
    frame++
    // 回雾：每 3 帧叠一层很淡的雾，擦开的地方会慢慢重新起雾
    if (frame % 3 === 0 && fogTex) {
      ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = .012
      ctx.drawImage(fogTex, 0, 0); ctx.restore()
    }
    drawRipples()
    if (!revealed && frame % 30 === 0 && clearedRatio() > .22) reveal()
    raf = requestAnimationFrame(tick)
  }

  function close() {
    if (!alive) return
    alive = false; cancelAnimationFrame(raf)
    try { localStorage.setItem(KEY, today) } catch { /* 存不上就明天再看一次 */ }
    ov.classList.add('sp-out')
    setTimeout(() => ov.remove(), 520)
  }

  ov.querySelector('.sp-enter').addEventListener('click', close)
  ov.querySelector('.sp-skip').addEventListener('click', close)
  ov.addEventListener('pointerdown', onDown)
  ov.addEventListener('pointermove', onMove, { passive: false })
  ov.addEventListener('pointerup', onUp); ov.addEventListener('pointercancel', onUp)
  addEventListener('resize', resize)

  resize()
  setTimeout(() => ov.querySelector('.sp-hint').classList.add('sp-show'), reduced ? 0 : 1400)
  setTimeout(reveal, 7000)          // 不想擦也行，7 秒后字和「进入」自己出来
  tick()
})()
