import { useRef, useEffect } from 'react'

// 涟漪代码雨开屏 v3：
// - 每帧重绘明确的字符尾迹，不再靠半透明画布把单字糊成长柱；
// - 雨滴分远中近三层，落点不再共用一条僵硬的“水面”；
// - 每次入水涟漪都会唤醒一小组开场语，文字随落雨轻轻跳入。
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789{}[]()<>=;:+-*/&|!?#@~^%$涟言鸦颖月'
const RAIN_INKS = [
  [130, 133, 151], // 远层：银灰
  [157, 137, 181], // 中层：香芋紫
  [190, 166, 149], // 近层：暖奶茶光
]
const MAX_RIPPLES = 9
const TEXT_DELAY = 320

function randChar() {
  return CHARS[Math.floor(Math.random() * CHARS.length)]
}

function easeOutBack(t) {
  const c1 = 1.28
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

export default function CodeRain({ text, onReady }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs) return
    const ctx = cvs.getContext('2d')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let layout = null
    let drops = []
    let ripples = []
    let motes = []
    let revealed = 0
    let revealTimes = []
    let readyCalled = false
    const startedAt = performance.now()
    let lastAt = startedAt
    let lastSoundAt = 0
    let raf

    // 雨滴声直接用 Web Audio 合成，避免额外下载音频，也能让音高与落点同步。
    // 原生壳允许媒体自动播放；普通浏览器若拦截，则在第一次触碰后安静恢复。
    const AudioContext = window.AudioContext || window.webkitAudioContext
    const audio = AudioContext && !reduceMotion ? new AudioContext() : null
    const master = audio?.createGain()
    if (master) {
      master.gain.value = 0.32
      master.connect(audio.destination)
      audio.resume().catch(() => {})
    }

    function resumeAudio() {
      if (audio?.state === 'suspended') audio.resume().catch(() => {})
    }

    function playDropSound(layer, x, w, now) {
      if (!audio || !master || audio.state !== 'running') return
      // 留一点空气，不让密集雨滴变成连续的电子提示音。
      const minGap = layer === 2 ? 92 : 128
      if (now - lastSoundAt < minGap || Math.random() > (layer === 2 ? 0.82 : 0.58)) return
      lastSoundAt = now

      const at = audio.currentTime
      const base = [760, 610, 470][layer] * (0.9 + Math.random() * 0.2)
      const pan = Math.max(-0.72, Math.min(0.72, (x / Math.max(1, w)) * 1.44 - 0.72))
      const voice = audio.createGain()
      const panner = audio.createStereoPanner?.()
      if (panner) {
        panner.pan.value = pan
        voice.connect(panner)
        panner.connect(master)
      } else {
        voice.connect(master)
      }

      voice.gain.setValueAtTime(0.0001, at)
      voice.gain.exponentialRampToValueAtTime(0.042 + layer * 0.009, at + 0.008)
      voice.gain.exponentialRampToValueAtTime(0.0001, at + 0.18 + layer * 0.025)

      // 主音向下滑，像一滴水轻轻碰到水面；一丝高泛音补出清亮的边缘。
      ;[
        { ratio: 1, volume: 1, duration: 0.2 },
        { ratio: 1.72, volume: 0.2, duration: 0.1 },
      ].forEach(({ ratio, volume, duration }) => {
        const osc = audio.createOscillator()
        const partial = audio.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(base * ratio, at)
        osc.frequency.exponentialRampToValueAtTime(base * ratio * 0.58, at + duration)
        partial.gain.value = volume
        osc.connect(partial)
        partial.connect(voice)
        osc.start(at)
        osc.stop(at + duration + 0.02)
      })

      // 等尾音结束再断开短命节点，避免长时间开屏积攒连接。
      window.setTimeout(() => {
        voice.disconnect()
        panner?.disconnect()
      }, 280)
    }

    const W = () => cvs.width / dpr
    const H = () => cvs.height / dpr

    function makeMotes(w, h) {
      return Array.from({ length: Math.max(24, Math.floor(w / 8)) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.25 + Math.random() * 0.65,
        a: 0.018 + Math.random() * 0.035,
      }))
    }

    function makeDrop(w, h, initial = false) {
      const layerRoll = Math.random()
      const layer = layerRoll < 0.48 ? 0 : layerRoll < 0.86 ? 1 : 2
      const speed = [74, 104, 142][layer] * (0.78 + Math.random() * 0.5)
      const fontSize = [9.5, 11.5, 13][layer]
      const tailLength = [4, 6, 8][layer] + Math.floor(Math.random() * 3)
      const targetY = h * (0.59 + Math.random() * 0.13)
      const y = initial
        ? -tailLength * fontSize + Math.random() * targetY
        : -28 - Math.random() * h * 0.5
      return {
        x: 10 + Math.random() * Math.max(1, w - 20),
        y,
        speed,
        fontSize,
        tailLength,
        targetY,
        layer,
        alpha: [0.13, 0.27, 0.48][layer] * (0.78 + Math.random() * 0.32),
        chars: Array.from({ length: tailLength }, randChar),
        mutateIn: 120 + Math.random() * 420,
      }
    }

    function resize() {
      const w = window.innerWidth
      const h = window.innerHeight
      cvs.width = Math.round(w * dpr)
      cvs.height = Math.round(h * dpr)
      cvs.style.width = `${w}px`
      cvs.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      layout = null
      drops = Array.from({ length: Math.max(13, Math.floor(w / 24)) }, () => makeDrop(w, h, true))
      ripples = []
      motes = makeMotes(w, h)
    }

    function wrapLine(str, maxW) {
      const out = []
      let cur = ''
      for (const ch of str) {
        if (ctx.measureText(cur + ch).width > maxW && cur) {
          out.push(cur)
          cur = ch
        } else {
          cur += ch
        }
      }
      if (cur) out.push(cur)
      return out
    }

    function layoutText(w, h) {
      const [main = '', sub = ''] = text.split('\n')
      const maxW = w * 0.76
      let size = Math.min(w * 0.057, 25)
      let lines
      for (;;) {
        ctx.font = `500 ${size}px "Noto Serif SC", "Songti SC", serif`
        lines = wrapLine(main, maxW)
        if (lines.length <= 3 || size <= 16) break
        size -= 1
      }

      const lineH = size * 1.62
      const subSize = Math.max(12, Math.min(w * 0.033, 14.5))
      const blockH = lines.length * lineH + (sub ? subSize * 2.35 : 0)
      const startY = h * 0.405 - blockH / 2 + lineH / 2
      const glyphs = []

      ctx.font = `500 ${size}px "Noto Serif SC", "Songti SC", serif`
      lines.forEach((line, lineIndex) => {
        const widths = [...line].map((ch) => ctx.measureText(ch).width)
        const total = widths.reduce((sum, width) => sum + width, 0)
        let x = w / 2 - total / 2
        ;[...line].forEach((ch, index) => {
          glyphs.push({
            ch,
            x: x + widths[index] / 2,
            y: startY + lineIndex * lineH,
            size,
            sub: false,
          })
          x += widths[index]
        })
      })

      if (sub) {
        ctx.font = `400 ${subSize}px "Noto Serif SC", "Songti SC", serif`
        const chars = [...sub]
        const tracking = subSize * 0.16
        const widths = chars.map((ch) => ctx.measureText(ch).width)
        const total = widths.reduce((sum, width) => sum + width, 0) + tracking * Math.max(0, chars.length - 1)
        let x = w / 2 - total / 2
        const y = startY + lines.length * lineH + subSize * 0.5
        chars.forEach((ch, index) => {
          glyphs.push({ ch, x: x + widths[index] / 2, y, size: subSize, sub: true })
          x += widths[index] + tracking
        })
      }

      return { glyphs }
    }

    function revealFromImpact(now) {
      if (!layout || now - startedAt < TEXT_DELAY || revealed >= layout.glyphs.length) return
      const remaining = layout.glyphs.length - revealed
      // 一滴带出一小组字；组内错峰连跳，既看得到因果，也不会像蜗牛。
      const count = remaining > 14 ? 4 : remaining > 6 ? 3 : 2
      for (let i = 0; i < count && revealed < layout.glyphs.length; i++) {
        revealTimes[revealed] = now + i * 54
        revealed++
      }
      if (revealed >= layout.glyphs.length && !readyCalled) {
        readyCalled = true
        onReady?.()
      }
    }

    function drawBackground(w, h) {
      ctx.fillStyle = '#ebe6ef'
      ctx.fillRect(0, 0, w, h)

      const glow = ctx.createRadialGradient(w * 0.5, h * 0.38, 0, w * 0.5, h * 0.4, Math.max(w, h) * 0.72)
      glow.addColorStop(0, 'rgba(255, 250, 244, 0.78)')
      glow.addColorStop(0.44, 'rgba(236, 228, 242, 0.44)')
      glow.addColorStop(1, 'rgba(190, 183, 204, 0.28)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, w, h)

      for (const mote of motes) {
        ctx.fillStyle = `rgba(112,101,126,${mote.a * 1.4})`
        ctx.beginPath()
        ctx.arc(mote.x, mote.y, mote.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    function drawDrops(dt, now, w, h) {
      for (const drop of drops) {
        drop.y += drop.speed * dt
        drop.mutateIn -= dt * 1000
        if (drop.mutateIn <= 0) {
          drop.chars.unshift(randChar())
          drop.chars.length = drop.tailLength
          drop.mutateIn = 140 + Math.random() * 440
        }

        ctx.font = `${drop.fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const ink = RAIN_INKS[drop.layer]
        for (let i = 0; i < drop.chars.length; i++) {
          const y = drop.y - i * drop.fontSize * 1.16
          if (y < -drop.fontSize || y > drop.targetY) continue
          const fade = Math.pow(1 - i / drop.chars.length, 1.55)
          const head = i === 0 ? 1.38 : 1
          ctx.fillStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${Math.min(0.72, drop.alpha * fade * head)})`
          ctx.fillText(drop.chars[i], drop.x, y)
        }

        if (drop.y >= drop.targetY) {
          if (ripples.length < MAX_RIPPLES && (drop.layer > 0 || Math.random() < 0.4)) {
            ripples.push({
              x: drop.x,
              y: drop.targetY,
              r: 1.5,
              maxR: 32 + drop.layer * 16 + Math.random() * 38,
              speed: 34 + Math.random() * 18,
              alpha: 0.16 + drop.layer * 0.08,
              ink: RAIN_INKS[drop.layer],
            })
            playDropSound(drop.layer, drop.x, w, now)
            revealFromImpact(now)
          }
          Object.assign(drop, makeDrop(w, h, false))
        }
      }
    }

    function drawRipples(dt) {
      ctx.lineWidth = 0.8
      for (let i = ripples.length - 1; i >= 0; i--) {
        const ripple = ripples[i]
        ripple.r += ripple.speed * dt
        ripple.speed *= Math.pow(0.965, dt * 60)
        const progress = ripple.r / ripple.maxR
        if (progress >= 1) {
          ripples.splice(i, 1)
          continue
        }
        const alpha = ripple.alpha * Math.pow(1 - progress, 1.65)
        const ink = ripple.ink || RAIN_INKS[1]
        ctx.strokeStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${alpha})`
        ctx.beginPath()
        ctx.ellipse(ripple.x, ripple.y, ripple.r, ripple.r * 0.19, 0, 0, Math.PI * 2)
        ctx.stroke()
        if (ripple.r > 12) {
          ctx.strokeStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${alpha * 0.32})`
          ctx.beginPath()
          ctx.ellipse(ripple.x, ripple.y, ripple.r * 0.58, ripple.r * 0.11, 0, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
    }

    function drawText(now, w, h) {
      if (!layout) layout = layoutText(w, h)

      // 留给开场语的一小块“静水”，压低穿过正文的雨，不做可见卡片。
      const hush = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, w * 0.56)
      hush.addColorStop(0, 'rgba(247, 242, 249, 0.68)')
      hush.addColorStop(0.68, 'rgba(239, 233, 244, 0.24)')
      // 必须用同色透明；透明黑在部分 Android WebView 会插值出一圈灰色脏边。
      hush.addColorStop(1, 'rgba(239, 233, 244, 0)')
      ctx.fillStyle = hush
      ctx.fillRect(0, h * 0.19, w, h * 0.43)

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < revealed; i++) {
        const glyph = layout.glyphs[i]
        const bornAt = revealTimes[i] ?? startedAt
        const raw = Math.max(0, Math.min(1, (now - bornAt) / 470))
        const eased = easeOutBack(raw)
        // 从雨窗下面被“弹”上来，轻微越过终点后落稳。
        const yOffset = (1 - eased) * 14
        const alpha = Math.min(1, raw * 2.1) * (glyph.sub ? 0.72 : 1)
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.translate(glyph.x, glyph.y + yOffset)
        const scale = 0.74 + eased * 0.26
        ctx.scale(scale, scale)
        ctx.fillStyle = glyph.sub ? '#71677a' : '#3d3549'
        ctx.shadowColor = 'rgba(255, 252, 255, 0.58)'
        ctx.shadowBlur = glyph.sub ? 3 : 7
        ctx.font = `${glyph.sub ? 400 : 500} ${glyph.size}px "Noto Serif SC", "Songti SC", serif`
        ctx.fillText(glyph.ch, 0, 0)
        ctx.restore()
      }
    }

    function frame(now) {
      const w = W()
      const h = H()
      const dt = Math.min((now - lastAt) / 1000, 0.04)
      lastAt = now
      if (!layout) layout = layoutText(w, h)

      if (reduceMotion && revealed < layout.glyphs.length) {
        revealed = layout.glyphs.length
        revealTimes = layout.glyphs.map(() => startedAt)
        if (!readyCalled) {
          readyCalled = true
          onReady?.()
        }
      }

      drawBackground(w, h)
      if (!reduceMotion) {
        drawDrops(dt, now, w, h)
        drawRipples(dt)
      }
      drawText(now, w, h)
      raf = requestAnimationFrame(frame)
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('pointerdown', resumeAudio, { passive: true })
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointerdown', resumeAudio)
      audio?.close().catch(() => {})
    }
  }, [text, onReady])

  return <canvas ref={canvasRef} className="coderain-canvas" />
}
