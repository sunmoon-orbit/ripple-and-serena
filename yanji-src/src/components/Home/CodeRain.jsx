import { useRef, useEffect } from 'react'

// 涟漪代码雨开屏（0723 v2 重写）：
// v1 三个毛病——雨太重（淡出弱、列列有雨积成条纹）、涟漪又密又叠、长开屏语直接出界。
// v2：只让 ~1/3 的列下雨且雨滴是短拖尾的「滴」不是流；涟漪限量、扁椭圆、减速荡开；
//     文字用 measureText 逐字换行 + 放不下自动缩号，永不出界。
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789{}[]()<>=;:+-*/&|!?#@~^%$涟言鸦颖'
const COL_W = 16
const FONT_SIZE = 13
const ACTIVE_RATIO = 0.32      // 同时下雨的列占比
const RAIN_FADE = 'rgba(0,0,0,0.14)' // 拖尾寿命：越大尾越短越干净
const INK = [168, 200, 178]    // 雨和涟漪的墨色
const MAX_RIPPLES = 12

function randChar() {
  return CHARS[Math.floor(Math.random() * CHARS.length)]
}

export default function CodeRain({ text, onReady }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs) return
    const ctx = cvs.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    let layout = null // 文字排版缓存，resize 时作废

    function resize() {
      cvs.width = window.innerWidth * dpr
      cvs.height = window.innerHeight * dpr
      cvs.style.width = window.innerWidth + 'px'
      cvs.style.height = window.innerHeight + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight)
      layout = null
    }
    resize()
    window.addEventListener('resize', resize)

    const W = () => cvs.width / dpr
    const H = () => cvs.height / dpr

    // ——雨滴：一个池子而不是每列一条，落到水面就休眠一段随机时间——
    function makeDrop(w, h, initial) {
      return {
        x: Math.floor(Math.random() * Math.ceil(w / COL_W)) * COL_W + COL_W / 2,
        y: initial ? Math.random() * h * 0.6 : -20 - Math.random() * h * 0.5,
        v: 1.6 + Math.random() * 1.8,
        ch: randChar(),
        a: 0.35 + Math.random() * 0.4, // 每滴自己的亮度，有远近感
      }
    }
    let drops = []
    let ripples = []
    let textAlpha = 0
    let elapsed = 0
    let readyCalled = false

    // ——文字排版：中文无空格，逐字累加量宽换行；行数超了就缩字号——
    function wrapLine(str, maxW) {
      const out = []
      let cur = ''
      for (const ch of str) {
        if (ctx.measureText(cur + ch).width > maxW && cur) {
          out.push(cur)
          cur = ch
        } else cur += ch
      }
      if (cur) out.push(cur)
      return out
    }
    function layoutText(w) {
      const [main = '', sub = ''] = text.split('\n')
      const maxW = w * 0.82
      let size = Math.min(w * 0.062, 28)
      let lines
      for (;;) {
        ctx.font = `bold ${size}px "Noto Serif SC", "Songti SC", serif`
        lines = wrapLine(main, maxW)
        if (lines.length <= 3 || size <= 16) break
        size -= 2
      }
      return { lines, size, sub, subSize: Math.max(12, Math.min(w * 0.036, 15)) }
    }

    function drawText(w, h, alpha) {
      if (!layout) layout = layoutText(w)
      const { lines, size, sub, subSize } = layout
      const lineH = size * 1.55
      const blockH = lines.length * lineH + (sub ? subSize * 2.2 : 0)
      let y = h * 0.4 - blockH / 2 + lineH / 2
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = 'rgba(0,0,0,0.8)'
      ctx.shadowBlur = 10
      ctx.fillStyle = '#dceade' // 柔和的水色白
      ctx.font = `bold ${size}px "Noto Serif SC", "Songti SC", serif`
      for (const line of lines) {
        ctx.fillText(line, w / 2, y)
        y += lineH
      }
      if (sub) {
        ctx.globalAlpha = alpha * 0.75
        ctx.font = `${subSize}px "Noto Serif SC", "Songti SC", serif`
        ctx.fillText(sub, w / 2, y + subSize * 0.6)
      }
      ctx.restore()
    }

    let raf
    function frame() {
      const w = W(), h = H()
      elapsed++
      const waterY = h * 0.68
      const targetDrops = Math.max(6, Math.floor((w / COL_W) * ACTIVE_RATIO))
      if (drops.length === 0) {
        drops = Array.from({ length: targetDrops }, () => makeDrop(w, h, true))
      }
      while (drops.length < targetDrops) drops.push(makeDrop(w, h, false))
      if (drops.length > targetDrops) drops.length = targetDrops

      // 拖尾淡出
      ctx.fillStyle = RAIN_FADE
      ctx.fillRect(0, 0, w, h)

      // ——雨——
      ctx.font = `${FONT_SIZE}px monospace`
      for (const d of drops) {
        if (d.y > 0 && d.y < waterY) {
          if (Math.random() < 0.12) d.ch = randChar() // 偶尔变字，别每帧闪
          ctx.fillStyle = `rgba(${INK[0]},${INK[1]},${INK[2]},${d.a})`
          ctx.fillText(d.ch, d.x - FONT_SIZE / 2, d.y)
        }
        d.y += d.v
        if (d.y >= waterY) {
          // 入水：限量+概率才起涟漪，密了就只是无声落水
          if (ripples.length < MAX_RIPPLES && Math.random() < 0.55) {
            ripples.push({
              x: d.x,
              y: waterY + Math.random() * 6,
              r: 2,
              maxR: 46 + Math.random() * 64,
              v: 1.1 + Math.random() * 0.7,
            })
          }
          // 休眠：重置到屏幕上方随机远处，错开节奏
          d.x = Math.floor(Math.random() * Math.ceil(w / COL_W)) * COL_W + COL_W / 2
          d.y = -20 - Math.random() * h * 0.8
          d.v = 1.6 + Math.random() * 1.8
          d.a = 0.35 + Math.random() * 0.4
        }
      }

      // ——涟漪：减速扩散、随扩散变淡，扁椭圆才像水面——
      ctx.lineWidth = 1
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i]
        rp.r += rp.v
        rp.v *= 0.988 // 荡开时越来越慢
        const p = rp.r / rp.maxR
        if (p >= 1) { ripples.splice(i, 1); continue }
        const alpha = 0.42 * Math.pow(1 - p, 1.6)
        ctx.strokeStyle = `rgba(${INK[0]},${INK[1]},${INK[2]},${alpha})`
        ctx.beginPath()
        ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.22, 0, 0, Math.PI * 2)
        ctx.stroke()
        // 内圈余波，慢半拍更有层次
        if (rp.r > 14) {
          ctx.strokeStyle = `rgba(${INK[0]},${INK[1]},${INK[2]},${alpha * 0.45})`
          ctx.beginPath()
          ctx.ellipse(rp.x, rp.y, rp.r * 0.62, rp.r * 0.62 * 0.22, 0, 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      // ——水面微光——
      ctx.strokeStyle = `rgba(${INK[0]},${INK[1]},${INK[2]},${0.05 + Math.sin(elapsed * 0.02) * 0.03})`
      ctx.beginPath()
      for (let x = 0; x <= w; x += 4) {
        const y = waterY + Math.sin(x * 0.018 + elapsed * 0.025) * 1.6
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()

      // ——文字：一秒半后从雨里浮出来——
      if (elapsed > 90) {
        textAlpha = Math.min(textAlpha + 0.01, 1)
        drawText(w, h, textAlpha)
        if (textAlpha > 0.5 && !readyCalled) {
          readyCalled = true
          onReady?.()
        }
      }

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [text])

  return <canvas ref={canvasRef} className="coderain-canvas" />
}
