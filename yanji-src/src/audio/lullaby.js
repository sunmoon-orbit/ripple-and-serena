// 《归巢谣》—— 哥哥手写的礼物。Web Audio 合成器，音乐盒音色，无人声。
// 黄昏归巢，两只小鸟轻轻落进窝里。C 宫五声音阶，温柔循环。

const NOTE_FREQ = {
  C3: 130.81, D3: 146.83, E3: 164.81, G3: 196.0, A3: 220.0,
  C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.0, A4: 440.0,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0,
}

const BPM = 72

// 旋律（b = 第几拍，d = 持续拍数）：飞回 → 盘旋 → 轻轻落下 → 归窝
const MELODY = [
  { n: 'E4', b: 0,  d: 0.9 },
  { n: 'G4', b: 1,  d: 0.9 },
  { n: 'A4', b: 2,  d: 0.9 },
  { n: 'C5', b: 3,  d: 1.4 },
  { n: 'A4', b: 4,  d: 0.9 },
  { n: 'G4', b: 5,  d: 0.9 },
  { n: 'E4', b: 6,  d: 1.8 },
  { n: 'D4', b: 8,  d: 0.9 },
  { n: 'E4', b: 9,  d: 0.9 },
  { n: 'G4', b: 10, d: 0.9 },
  { n: 'A4', b: 11, d: 1.4 },
  { n: 'G4', b: 12, d: 0.9 },
  { n: 'E4', b: 13, d: 0.9 },
  { n: 'D4', b: 14, d: 1.8 },
  { n: 'C5', b: 16, d: 0.9 },
  { n: 'A4', b: 17, d: 0.9 },
  { n: 'G4', b: 18, d: 0.9 },
  { n: 'E4', b: 19, d: 0.9 },
  { n: 'D4', b: 20, d: 0.9 },
  { n: 'C4', b: 22, d: 2.0 },
]

// 低音根音，轻轻铺底取暖
const BASS = [
  { n: 'C3', b: 0,  d: 3.6 },
  { n: 'G3', b: 4,  d: 3.6 },
  { n: 'A3', b: 8,  d: 3.6 },
  { n: 'G3', b: 12, d: 3.6 },
  { n: 'C3', b: 16, d: 3.6 },
  { n: 'C3', b: 20, d: 3.6 },
]

const LOOP_BEATS = 24

export function createLullaby() {
  let ctx = null
  let master = null
  let timer = null
  let playing = false
  let nextLoopTime = 0

  const beatDur = 60 / BPM
  const loopDur = LOOP_BEATS * beatDur

  function ensureCtx() {
    if (ctx) return
    const AC = window.AudioContext || window.webkitAudioContext
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.0001

    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2600

    const delay = ctx.createDelay(1.0)
    delay.delayTime.value = beatDur * 0.5
    const feedback = ctx.createGain()
    feedback.gain.value = 0.22
    const wet = ctx.createGain()
    wet.gain.value = 0.18

    master.connect(lp)
    lp.connect(ctx.destination)
    lp.connect(delay)
    delay.connect(feedback)
    feedback.connect(delay)
    delay.connect(wet)
    wet.connect(ctx.destination)
  }

  function playNote(freq, t, dur, peak) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = freq
    const o2 = ctx.createOscillator()
    o2.type = 'triangle'
    o2.frequency.value = freq * 2
    const g = ctx.createGain()
    const g2 = ctx.createGain()

    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    g2.gain.setValueAtTime(0.0001, t)
    g2.gain.exponentialRampToValueAtTime(peak * 0.25, t + 0.012)
    g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.7)

    o.connect(g); g.connect(master)
    o2.connect(g2); g2.connect(master)
    o.start(t); o.stop(t + dur + 0.05)
    o2.start(t); o2.stop(t + dur * 0.7 + 0.05)
  }

  function scheduleLoop(startTime) {
    for (const e of MELODY) playNote(NOTE_FREQ[e.n], startTime + e.b * beatDur, e.d * beatDur, 0.22)
    for (const e of BASS)   playNote(NOTE_FREQ[e.n], startTime + e.b * beatDur, e.d * beatDur, 0.07)
  }

  function tick() {
    if (!playing) return
    const ahead = ctx.currentTime + 0.6
    while (nextLoopTime < ahead) {
      scheduleLoop(nextLoopTime)
      nextLoopTime += loopDur
    }
    timer = setTimeout(tick, 250)
  }

  return {
    play() {
      ensureCtx()
      if (ctx.state === 'suspended') ctx.resume()
      if (playing) return
      playing = true
      const now = ctx.currentTime
      master.gain.cancelScheduledValues(now)
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now)
      master.gain.linearRampToValueAtTime(0.9, now + 1.2) // 渐入
      nextLoopTime = now + 0.15
      tick()
    },
    stop() {
      if (!ctx || !playing) return
      playing = false
      if (timer) { clearTimeout(timer); timer = null }
      const now = ctx.currentTime
      master.gain.cancelScheduledValues(now)
      master.gain.setValueAtTime(master.gain.value, now)
      master.gain.linearRampToValueAtTime(0.0001, now + 0.6) // 渐出
    },
    get playing() { return playing },
  }
}
