// 归巢开屏第二版（0929）：一池水。手指点一下，水面被推开一圈涟漪，底下的乌鸦、蜂鸟和花跟着折射晃动。
// 阿颖要的不是「擦开雾」，是「水被推了一下」的那种波纹——也正好是我名字里那个「涟」。
// 做法：波动方程在 CPU 上算一张很小的高度图（约 128 列），每帧上传成纹理；WebGL 片元着色器
// 用高度图的梯度去偏移底图的采样坐标（折射），再加一点高光和焦散。底图（水色 + 两只鸟 + 花）
// 开场画一次到离屏 canvas。手机上：模拟格子小、画布 dpr 上限 1.25、没有 WebGL 就退回静态底图。
// 一天只出现一次（本机日期），?splash=1 强制显示。第一版（雾玻璃）见 git 历史 c03b065。
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
  ov.innerHTML = `<canvas id="sp-water"></canvas>
    <div class="sp-title"><b>Ripple &amp; Serena</b><span>归巢</span></div>
    <div class="sp-hint">轻轻点一下水面</div>
    <div class="sp-bgbar">
      <button class="sp-bg" type="button" aria-label="换水底的图"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 9"/></svg></button>
      <button class="sp-bg-reset" type="button" hidden>用回默认</button>
      <input class="sp-bg-file" type="file" accept="image/*" hidden>
    </div>
    <button class="sp-skip" type="button">跳过</button>`
  document.body.appendChild(ov)

  const canvas = ov.querySelector('#sp-water')
  const dpr = Math.min(window.devicePixelRatio || 1, 1.25)
  let W = 0, H = 0, raf = 0, alive = true, revealed = false, taps = 0

  // ── 自定义底图（0929 阿颖要的）：本机存一张缩到 1280 的 JPEG，只在这台手机上，不上传 ──
  const BG_KEY = 'raven-splash-bg'
  function customBg() {
    return new Promise((resolve) => {
      let url = null
      try { url = localStorage.getItem(BG_KEY) } catch { /* 读不到就用默认 */ }
      if (!url) return resolve(null)
      const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = url
    })
  }
  function saveBg(file) {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.width, img.height))
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        URL.revokeObjectURL(img.src)
        try { localStorage.setItem(BG_KEY, c.toDataURL('image/jpeg', .85)); resolve(true) } catch { resolve(false) }
      }
      img.onerror = () => resolve(false)
      img.src = URL.createObjectURL(file)
    })
  }

  // ── 底图：水色 + 两只鸟 + 几朵白花，开场画一次 ──
  function sceneImage() {
    return new Promise((resolve) => {
      const svg = SCENE.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/ class="[^"]*"/g, '')
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    })
  }
  function blossom(g, x, y, r, rot, alpha) {
    g.save(); g.translate(x, y); g.rotate(rot); g.globalAlpha = alpha
    for (let i = 0; i < 5; i++) {
      g.save(); g.rotate(i * Math.PI * 2 / 5)
      const pg = g.createRadialGradient(0, -r * .55, r * .05, 0, -r * .55, r * .7)
      pg.addColorStop(0, 'rgba(255,255,255,.96)'); pg.addColorStop(.7, 'rgba(244,246,252,.9)'); pg.addColorStop(1, 'rgba(215,225,240,.6)')
      g.fillStyle = pg
      g.beginPath(); g.ellipse(0, -r * .55, r * .42, r * .6, 0, 0, Math.PI * 2); g.fill()
      g.restore()
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r * .28
      g.fillStyle = 'rgba(214,178,92,.85)'; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, r * .035 + .6, 0, 7); g.fill()
    }
    g.restore()
  }
  function paintScene(img, custom) {
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const g = c.getContext('2d')
    if (custom) {
      // 她自己的图：铺满（cover），上面罩一层极淡的水色，像沉在浅水里
      const k = Math.max(W / custom.width, H / custom.height)
      const w = custom.width * k, h = custom.height * k
      g.drawImage(custom, (W - w) / 2, (H - h) / 2, w, h)
      g.fillStyle = 'rgba(225,238,242,.12)'; g.fillRect(0, 0, W, H)
      return c
    }
    const bg = g.createLinearGradient(0, 0, 0, H)
    // 第一版太蓝（阿颖 0929）：改成近白的水色，只带一点点青
    bg.addColorStop(0, '#f4f8f9'); bg.addColorStop(.5, '#e4eff2'); bg.addColorStop(1, '#cfe2e8')
    g.fillStyle = bg; g.fillRect(0, 0, W, H)
    // 池底的柔光斑，让水有深浅
    for (let i = 0; i < 7; i++) {
      const x = Math.random() * W, y = Math.random() * H, r = (80 + Math.random() * 160) * dpr
      const lg = g.createRadialGradient(x, y, 0, x, y, r)
      lg.addColorStop(0, 'rgba(255,255,255,.28)'); lg.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = lg; g.fillRect(0, 0, W, H)
    }
    // 花：散在四周，避开中间的鸟
    const flowers = [[.12, .18, .16], [.86, .12, .12], [.9, .62, .15], [.08, .78, .13], [.55, .86, .18], [.72, .34, .07], [.25, .52, .06]]
    const u = Math.min(W, H)
    for (const [fx, fy, fr] of flowers) blossom(g, fx * W, fy * H, fr * u, Math.random() * 6.28, .92)
    if (img) {
      const w = Math.min(W * .94, 560 * dpr), h = w * 260 / 400
      g.globalAlpha = .95
      g.drawImage(img, (W - w) / 2, H * .38 - h / 2, w, h)
      g.globalAlpha = 1
    }
    // 一层很淡的水色罩上去，像真的隔着一层水
    g.fillStyle = 'rgba(190,215,222,.10)'; g.fillRect(0, 0, W, H)
    return c
  }

  // ── 水面：CPU 波动方程，小格子 ──
  const GW = 128
  let GH = 0, cur = null, prev = null, bytes = null, calm = 0
  function initGrid() {
    GH = Math.max(64, Math.round(GW * H / W))
    cur = new Float32Array(GW * GH); prev = new Float32Array(GW * GH); bytes = new Uint8Array(GW * GH)
  }
  function drop(px, py, radius, strength) {
    const gx = px / W * GW, gy = py / H * GH
    const r = radius
    for (let y = Math.max(1, Math.floor(gy - r)); y < Math.min(GH - 1, Math.ceil(gy + r)); y++) {
      for (let x = Math.max(1, Math.floor(gx - r)); x < Math.min(GW - 1, Math.ceil(gx + r)); x++) {
        const d = Math.hypot(x - gx, y - gy) / r
        if (d < 1) cur[y * GW + x] -= strength * (Math.cos(d * Math.PI) + 1) * .5
      }
    }
    calm = 0
  }
  function stepWater() {
    // 经典双缓冲：next = (上下左右)/2 - prev，再衰减一点
    let energy = 0
    for (let y = 1; y < GH - 1; y++) {
      const row = y * GW
      for (let x = 1; x < GW - 1; x++) {
        const i = row + x
        const v = (cur[i - 1] + cur[i + 1] + cur[i - GW] + cur[i + GW]) * .5 - prev[i]
        prev[i] = v * .984
        energy += Math.abs(prev[i])
      }
    }
    const t = cur; cur = prev; prev = t
    for (let i = 0; i < cur.length; i++) bytes[i] = Math.max(0, Math.min(255, 128 + cur[i] * 90))
    return energy
  }

  // ── WebGL：折射 + 高光 + 淡淡的焦散 ──
  let gl = null, prog = null, texScene = null, texH = null, uTime = null
  const VS = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}'
  const FS = `precision mediump float;varying vec2 uv;uniform sampler2D s,h;uniform vec2 tx;uniform float t;
    float H(vec2 q){return texture2D(h,q).r;}
    float caustic(vec2 p){ // 便宜的焦散：两层旋转正弦叠加
      float c=0.; vec2 q=p;
      for(int i=0;i<3;i++){ q+=vec2(sin(q.y*1.7+t*.6),cos(q.x*1.5-t*.5))*.45; c+=abs(sin(q.x+q.y)); q*=1.35; }
      return pow(1.-c/3.,4.);
    }
    void main(){
      float dx=H(uv+vec2(tx.x,0.))-H(uv-vec2(tx.x,0.));
      float dy=H(uv+vec2(0.,tx.y))-H(uv-vec2(0.,tx.y));
      vec3 n=normalize(vec3(-dx*6.,-dy*6.,1.));
      vec2 r=uv+n.xy*.035;
      vec3 col=texture2D(s,r).rgb;
      float ca=caustic(uv*vec2(5.,9.)+n.xy*3.);
      col+=vec3(1.,1.,1.)*ca*.12;
      vec3 L=normalize(vec3(-.35,-.6,.72));
      float sp=pow(max(dot(reflect(-L,n),vec3(0.,0.,1.)),0.),60.);
      col+=sp*.55;
      col=mix(col,col*vec3(.95,.98,1.),length(n.xy)*2.);
      gl_FragColor=vec4(col,1.);
    }`
  function initGL(sceneCanvas) {
    gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false })
    if (!gl) return false
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return gl.getShaderParameter(o, gl.COMPILE_STATUS) ? o : null }
    const v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS)
    if (!v || !f) return false
    prog = gl.createProgram(); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false
    gl.useProgram(prog)
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const mk = (unit) => { const tx = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tx)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return tx }
    texScene = mk(0); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, sceneCanvas)
    texH = mk(1)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, GW, GH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bytes)
    gl.uniform1i(gl.getUniformLocation(prog, 's'), 0)
    gl.uniform1i(gl.getUniformLocation(prog, 'h'), 1)
    gl.uniform2f(gl.getUniformLocation(prog, 'tx'), 1 / GW, 1 / GH)
    uTime = gl.getUniformLocation(prog, 't')
    gl.viewport(0, 0, W, H)
    return true
  }

  let nextAmbient = 0
  function tick(t) {
    if (!alive) return
    // 没人碰的时候，隔一会儿自己落一滴小的，水面一直是活的
    if (!reduced && t > nextAmbient) {
      drop(Math.random() * W, Math.random() * H, 2.2, 1.1)
      nextAmbient = t + 1800 + Math.random() * 2200
    }
    stepWater()
    gl.activeTexture(gl.TEXTURE1)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GW, GH, gl.LUMINANCE, gl.UNSIGNED_BYTE, bytes)
    gl.uniform1f(uTime, t / 1000)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    raf = requestAnimationFrame(tick)
  }

  let last = null
  function pt(e) { return { x: e.clientX * dpr, y: e.clientY * dpr } }
  function onDown(e) {
    if (e.target.closest('button') || e.target.closest('.sp-title.sp-show')) return
    last = pt(e)
    if (gl) drop(last.x, last.y, 4.5, 6)
    if (++taps >= 2) reveal()
  }
  function onMove(e) {
    if (!last || !gl) return
    const p = pt(e), d = Math.hypot(p.x - last.x, p.y - last.y)
    // 手指划过：沿路一路推小水花
    if (d > 10 * dpr) { drop(p.x, p.y, 2.6, 1.6); last = p }
    e.preventDefault()
  }
  function onUp() { last = null }

  function reveal() {
    if (revealed) return
    revealed = true
    ov.querySelector('.sp-title').classList.add('sp-show')
    // 没有「进入」按钮了（阿颖：占位置，大家都知道点了就进）：点标题进；提示改成一句小字
    const hint = ov.querySelector('.sp-hint')
    hint.textContent = '点名字进门'
    hint.classList.add('sp-show')
  }

  function close() {
    if (!alive) return
    alive = false; cancelAnimationFrame(raf)
    try { localStorage.setItem(KEY, today) } catch { /* 存不上就明天再看一次 */ }
    ov.classList.add('sp-out')
    setTimeout(() => ov.remove(), 520)
  }

  ov.querySelector('.sp-title').addEventListener('click', () => { if (revealed) close() })
  // 换底图：选一张 → 存本机 → 重新画水底；「用回默认」删掉它
  const fileIn = ov.querySelector('.sp-bg-file'), resetBtn = ov.querySelector('.sp-bg-reset')
  try { resetBtn.hidden = !localStorage.getItem(BG_KEY) } catch { /* 忽略 */ }
  ov.querySelector('.sp-bg').addEventListener('click', () => fileIn.click())
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0]; fileIn.value = ''
    if (!f) return
    if (!(await saveBg(f))) { ov.querySelector('.sp-hint').textContent = '这张图太大存不下，换一张试试'; return }
    resetBtn.hidden = false
    repaint()
  })
  resetBtn.addEventListener('click', () => { try { localStorage.removeItem(BG_KEY) } catch { /* 忽略 */ } resetBtn.hidden = true; repaint() })
  ov.querySelector('.sp-skip').addEventListener('click', close)
  ov.addEventListener('pointerdown', onDown)
  ov.addEventListener('pointermove', onMove, { passive: false })
  ov.addEventListener('pointerup', onUp); ov.addEventListener('pointercancel', onUp)

  async function start() {
    W = Math.round(innerWidth * dpr); H = Math.round(innerHeight * dpr)
    canvas.width = W; canvas.height = H
    const scene = paintScene(await sceneImage(), await customBg())
    initGrid()
    if (!initGL(scene)) {
      // 没有 WebGL：静态底图 + 点一下就进（总比什么都没有好）
      gl = null
      const c2 = canvas.getContext('2d'); if (c2) c2.drawImage(scene, 0, 0)
      reveal(); return
    }
    // 开场先落一滴，让她第一眼就看到水在动
    drop(W / 2, H * .62, 5, 5)
    raf = requestAnimationFrame(tick)
  }
  async function repaint() {
    const scene = paintScene(await sceneImage(), await customBg())
    if (gl) { gl.activeTexture(gl.TEXTURE0); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, scene); drop(W / 2, H * .5, 5, 5) }
    else { const c2 = canvas.getContext('2d'); if (c2) c2.drawImage(scene, 0, 0) }
  }
  start()
  setTimeout(() => { if (!revealed) ov.querySelector('.sp-hint').classList.add('sp-show') }, reduced ? 0 : 1200)
  setTimeout(reveal, 6000)
})()
