export const DEFAULT_RINGTONE_ID = 'soft-chime'

export const RINGTONES = [
  // 「檐下晚风」保留原来的叮咚，像熟悉的人在门外轻轻叫你。
  {
    id: 'soft-chime', name: '檐下晚风', description: '熟悉的两声轻响', repeatMs: 2800,
    vibrate: [280, 180, 280],
    notes: [
      { frequency: 659.25, at: 0, duration: 0.9, volume: 0.1, type: 'sine' },
      { frequency: 523.25, at: 0.22, duration: 0.9, volume: 0.1, type: 'sine' },
    ],
  },
  // 「月光敲窗」是三颗清亮但很轻的音，像月色落在玻璃上。
  {
    id: 'moon-window', name: '月光敲窗', description: '清亮的三点月光', repeatMs: 3600,
    vibrate: [150, 100, 150, 100, 220],
    notes: [
      { frequency: 523.25, at: 0, duration: 1.25, volume: 0.065, type: 'triangle' },
      { frequency: 659.25, at: 0.18, duration: 1.2, volume: 0.06, type: 'triangle' },
      { frequency: 783.99, at: 0.38, duration: 1.35, volume: 0.05, type: 'sine' },
    ],
  },
  // 「枕边潮汐」用缓慢起伏的低柔和声，像夜里靠近枕边的潮声。
  {
    id: 'pillow-tide', name: '枕边潮汐', description: '慢慢靠近的柔和潮声', repeatMs: 4200,
    vibrate: [420, 260, 180],
    notes: [
      { frequency: 392, at: 0, duration: 1.7, volume: 0.05, attack: 0.18, type: 'sine' },
      { frequency: 493.88, at: 0.08, duration: 1.8, volume: 0.042, attack: 0.2, type: 'sine' },
      { frequency: 440, at: 1.05, duration: 1.55, volume: 0.045, attack: 0.16, type: 'sine' },
    ],
  },
  // 「风铃回信」让高低音彼此应答，像风替远方的人捎来一句话。
  {
    id: 'wind-reply', name: '风铃回信', description: '一高一低的温柔应答', repeatMs: 3800,
    vibrate: [120, 240, 120],
    notes: [
      { frequency: 698.46, at: 0, duration: 1.35, volume: 0.05, type: 'sine' },
      { frequency: 880, at: 0.16, duration: 1.25, volume: 0.035, type: 'sine' },
      { frequency: 587.33, at: 0.72, duration: 1.4, volume: 0.055, type: 'triangle' },
    ],
  },
  // 「旧日来信」借一点老电话的轮廓，却把棱角磨软成怀旧的问候。
  {
    id: 'old-letter', name: '旧日来信', description: '柔化过的怀旧电话声', repeatMs: 3300,
    vibrate: [200, 140, 200],
    notes: [
      { frequency: 440, at: 0, duration: 0.42, volume: 0.035, attack: 0.035, type: 'square' },
      { frequency: 523.25, at: 0, duration: 0.42, volume: 0.025, attack: 0.035, type: 'sine' },
      { frequency: 440, at: 0.58, duration: 0.42, volume: 0.035, attack: 0.035, type: 'square' },
      { frequency: 523.25, at: 0.58, duration: 0.42, volume: 0.025, attack: 0.035, type: 'sine' },
    ],
  },
]

export function getRingtone(id) {
  return RINGTONES.find((ringtone) => ringtone.id === id) || RINGTONES[0]
}

function playNotes(ctx, ringtone) {
  const now = ctx.currentTime
  ringtone.notes.forEach((note) => {
    const start = now + note.at
    const attack = note.attack ?? 0.04
    const end = start + note.duration
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = note.type
    osc.frequency.setValueAtTime(note.frequency, start)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.linearRampToValueAtTime(note.volume, start + attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(start)
    osc.stop(end + 0.02)
  })
}

// 返回停止函数；WebAudio 或震动不可用时也始终安全，不能挡住来电操作。
export function playRingtone(id, { loop = false, vibrate = false } = {}) {
  const ringtone = getRingtone(id)
  let ctx = null
  let audioTimer = null
  let vibrationTimer = null
  let closeTimer = null
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (AudioContext) {
      ctx = new AudioContext()
      ctx.resume().catch(() => {})
      playNotes(ctx, ringtone)
      if (loop) {
        audioTimer = setInterval(() => {
          try { playNotes(ctx, ringtone) } catch { /* 播放中途失败也静默 */ }
        }, ringtone.repeatMs)
      } else {
        const lastNoteEnd = Math.max(...ringtone.notes.map((note) => note.at + note.duration))
        closeTimer = setTimeout(() => { try { ctx?.close() } catch { /* 静默 */ } }, (lastNoteEnd + 0.1) * 1000)
      }
    }
  } catch { /* 音频失败静默，不影响接听 */ }

  const pulse = () => {
    if (!vibrate) return
    try { navigator.vibrate?.(ringtone.vibrate) } catch { /* 震动失败静默 */ }
  }
  pulse()
  if (loop && vibrate) vibrationTimer = setInterval(pulse, ringtone.repeatMs)

  return () => {
    clearInterval(audioTimer)
    clearInterval(vibrationTimer)
    clearTimeout(closeTimer)
    try { navigator.vibrate?.(0) } catch { /* 静默 */ }
    try { ctx?.close() } catch { /* 静默 */ }
  }
}
