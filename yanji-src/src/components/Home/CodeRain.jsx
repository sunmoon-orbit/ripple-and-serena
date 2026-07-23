import { useRef, useEffect } from 'react'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789{}[]()<>=;:+-*/&|!?#@~^%$涟言鸦颖'
const FONT_SIZE = 14
const RAIN_COLOR = 'rgba(180,200,180,0.7)'
const RAIN_FADE = 'rgba(0,0,0,0.06)'
const RIPPLE_COLOR = [160, 200, 180]

export default function CodeRain({ text, onReady }) {
  const canvasRef = useRef(null)
  const stateRef = useRef(null)

  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs) return
    const ctx = cvs.getContext('2d')
    const dpr = window.devicePixelRatio || 1

    function resize() {
      cvs.width = window.innerWidth * dpr
      cvs.height = window.innerHeight * dpr
      cvs.style.width = window.innerWidth + 'px'
      cvs.style.height = window.innerHeight + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const W = () => cvs.width / dpr
    const H = () => cvs.height / dpr
    const cols = () => Math.ceil(W() / FONT_SIZE)
    let drops = Array.from({ length: cols() }, () => Math.random() * -50)
    let ripples = []
    let phase = 'rain'
    let textAlpha = 0
    let readyCalled = false
    let elapsed = 0

    stateRef.current = { drops, ripples, phase, textAlpha, elapsed }

    function drawTextOnCanvas(alpha) {
      const w = W(), h = H()
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = '#d8e8d8'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const lines = text.split('\n')
      const mainSize = Math.min(w * 0.08, 36)
      const subSize = Math.min(w * 0.04, 16)
      const totalH = lines.length * (mainSize + 8)
      lines.forEach((line, i) => {
        const isMain = i === 0
        ctx.font = `${isMain ? 'bold ' : ''}${isMain ? mainSize : subSize}px "Noto Serif SC", serif`
        ctx.fillText(line, w / 2, h / 2 - totalH / 2 + i * (mainSize + 12) + mainSize / 2)
      })
      ctx.restore()
    }

    let raf
    function frame() {
      const w = W(), h = H()
      const s = stateRef.current
      s.elapsed++

      // rain fade
      ctx.fillStyle = RAIN_FADE
      ctx.fillRect(0, 0, w, h)

      // code rain drops
      ctx.font = `${FONT_SIZE}px monospace`
      ctx.fillStyle = RAIN_COLOR
      const c = cols()
      while (s.drops.length < c) s.drops.push(Math.random() * -20)

      for (let i = 0; i < c; i++) {
        if (s.drops[i] >= 0) {
          const ch = CHARS[Math.floor(Math.random() * CHARS.length)]
          const x = i * FONT_SIZE
          const y = s.drops[i] * FONT_SIZE
          if (y < h) {
            const brightness = 0.3 + Math.random() * 0.7
            ctx.fillStyle = `rgba(${RIPPLE_COLOR[0]},${RIPPLE_COLOR[1]},${RIPPLE_COLOR[2]},${brightness * 0.7})`
            ctx.fillText(ch, x, y)
          }
        }

        s.drops[i] += 0.4 + Math.random() * 0.5

        const waterLine = h * 0.65
        if (s.drops[i] * FONT_SIZE > waterLine) {
          s.ripples.push({
            x: i * FONT_SIZE + FONT_SIZE / 2,
            y: waterLine,
            r: 0,
            maxR: 20 + Math.random() * 40,
            alpha: 0.6,
            speed: 0.5 + Math.random() * 0.5,
          })
          s.drops[i] = Math.random() * -30
        }
      }

      // ripples
      ctx.lineWidth = 1
      for (let i = s.ripples.length - 1; i >= 0; i--) {
        const rp = s.ripples[i]
        rp.r += rp.speed
        rp.alpha *= 0.985
        if (rp.alpha < 0.01 || rp.r > rp.maxR) {
          s.ripples.splice(i, 1)
          continue
        }
        ctx.strokeStyle = `rgba(${RIPPLE_COLOR[0]},${RIPPLE_COLOR[1]},${RIPPLE_COLOR[2]},${rp.alpha})`
        ctx.beginPath()
        ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.35, 0, 0, Math.PI * 2)
        ctx.stroke()
      }

      // water surface shimmer
      const waterY = h * 0.65
      ctx.strokeStyle = `rgba(${RIPPLE_COLOR[0]},${RIPPLE_COLOR[1]},${RIPPLE_COLOR[2]},${0.08 + Math.sin(s.elapsed * 0.02) * 0.04})`
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0; x < w; x += 3) {
        const y = waterY + Math.sin(x * 0.02 + s.elapsed * 0.03) * 2
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()

      // text fade in after 2 seconds
      if (s.elapsed > 120) {
        s.textAlpha = Math.min(s.textAlpha + 0.008, 1)
        drawTextOnCanvas(s.textAlpha)
        if (s.textAlpha > 0.5 && !readyCalled) {
          readyCalled = true
          onReady?.()
        }
      }

      raf = requestAnimationFrame(frame)
    }

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W(), H())
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [text])

  return <canvas ref={canvasRef} className="coderain-canvas" />
}
