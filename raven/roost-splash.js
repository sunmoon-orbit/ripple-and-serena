(() => {
  'use strict'

  const DAILY_KEY = 'raven-splash-day'
  const DATE_STAMP = new Date().toLocaleDateString('en-CA')
  let overlay
  let canvas
  let ctx
  let pointerId = null
  let lastPoint = null
  let revealScore = 0
  let resizeTimer = null
  let leaving = false

  function fogGradient(width, height) {
    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, '#cbd1d4')
    gradient.addColorStop(.35, '#aeb8bf')
    gradient.addColorStop(.66, '#d6d6d0')
    gradient.addColorStop(1, '#8997a3')
    return gradient
  }

  function paintFog() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rect = overlay.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx = canvas.getContext('2d', { alpha: true })
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = fogGradient(rect.width, rect.height)
    ctx.fillRect(0, 0, rect.width, rect.height)

    const glow = ctx.createRadialGradient(
      rect.width * .55, rect.height * .35, 0,
      rect.width * .55, rect.height * .35, Math.max(rect.width, rect.height) * .72
    )
    glow.addColorStop(0, 'rgba(255,255,255,.24)')
    glow.addColorStop(.52, 'rgba(239,243,242,.08)')
    glow.addColorStop(1, 'rgba(72,88,102,.18)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, rect.width, rect.height)

    ctx.globalAlpha = .12
    for (let i = 0; i < 16; i += 1) {
      const y = (i / 15) * rect.height
      ctx.beginPath()
      ctx.ellipse(
        rect.width * (.2 + (i % 4) * .22), y,
        rect.width * (.28 + (i % 3) * .08), 24 + (i % 5) * 13,
        -.16 + (i % 3) * .13, 0, Math.PI * 2
      )
      ctx.fillStyle = i % 2 ? '#eef1ef' : '#70808d'
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function erase(from, to) {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const distance = Math.hypot(dx, dy)
    const radius = Math.max(25, Math.min(46, canvas.clientWidth * .105))
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = radius * 2
    ctx.strokeStyle = 'rgba(0,0,0,.82)'
    ctx.shadowBlur = radius * .62
    ctx.shadowColor = 'rgba(0,0,0,.9)'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    ctx.restore()

    revealScore += distance * radius * 1.7
    const threshold = canvas.clientWidth * canvas.clientHeight * .32
    if (revealScore >= threshold) leave()
  }

  function ripple(point) {
    const node = document.createElement('span')
    node.className = 'roost-splash-ripple'
    node.style.left = `${point.x}px`
    node.style.top = `${point.y}px`
    overlay.appendChild(node)
    node.addEventListener('animationend', () => node.remove(), { once: true })
  }

  function onPointerDown(event) {
    if (leaving || pointerId !== null) return
    pointerId = event.pointerId
    canvas.setPointerCapture?.(pointerId)
    lastPoint = pointFromEvent(event)
    erase(lastPoint, { x: lastPoint.x + .5, y: lastPoint.y + .5 })
    ripple(lastPoint)
  }

  function onPointerMove(event) {
    if (event.pointerId !== pointerId || !lastPoint || leaving) return
    const next = pointFromEvent(event)
    erase(lastPoint, next)
    lastPoint = next
  }

  function onPointerUp(event) {
    if (event.pointerId !== pointerId) return
    ripple(pointFromEvent(event))
    pointerId = null
    lastPoint = null
  }

  function leave() {
    if (!overlay || leaving) return
    leaving = true
    localStorage.setItem(DAILY_KEY, DATE_STAMP)
    overlay.classList.add('is-leaving')
    window.setTimeout(() => {
      overlay.classList.remove('is-visible', 'is-ready', 'is-leaving')
      overlay.setAttribute('aria-hidden', 'true')
      document.documentElement.style.overflow = ''
      leaving = false
    }, 580)
  }

  function show(force = false) {
    if (!overlay || overlay.classList.contains('is-visible')) return
    if (!force) {
      if (!localStorage.getItem('raven-token')) return
      if (localStorage.getItem(DAILY_KEY) === DATE_STAMP) return
    }
    revealScore = 0
    pointerId = null
    lastPoint = null
    overlay.classList.add('is-visible')
    overlay.setAttribute('aria-hidden', 'false')
    document.documentElement.style.overflow = 'hidden'
    paintFog()
    requestAnimationFrame(() => overlay.classList.add('is-ready'))
  }

  function init() {
    overlay = document.getElementById('roost-splash')
    canvas = document.getElementById('roost-splash-fog')
    if (!overlay || !canvas) return

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    document.getElementById('roost-splash-skip')?.addEventListener('click', leave)
    document.getElementById('splash-replay-btn')?.addEventListener('click', () => {
      document.getElementById('bg-menu')?.classList.remove('open')
      show(true)
    })
    window.addEventListener('resize', () => {
      if (!overlay.classList.contains('is-visible')) return
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        revealScore = 0
        paintFog()
      }, 180)
    })

    window.roostSplashShow = () => show(true)
    show(false)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
