// 全局单例播放器：一个 Audio 元素跨页面存活（挂在 App 根，切面板不中断）。
// pub/sub 模式，组件用 usePlayer() 订阅状态。
import { useState, useEffect } from 'react'
import { resolvePlayable, getLyric } from '../api/music'

let audio = null
const state = {
  track: null,       // {url, source, id, name, artist, cover, lyric_id}
  playing: false,
  currentTime: 0,
  duration: 0,
  lyrics: [],        // [{t, text}]
  loading: false,
  error: '',
}
const listeners = new Set()

function emit() {
  const snap = { ...state }
  listeners.forEach((fn) => fn(snap))
}

function ensureAudio() {
  if (audio) return audio
  audio = new Audio()
  // 挂进 DOM：安卓 Chrome 对游离 Audio 的媒体通知按钮分发不可靠（0712 暂停键失灵实测）
  audio.style.display = 'none'
  document.body.appendChild(audio)
  audio.addEventListener('timeupdate', () => { state.currentTime = audio.currentTime; emit(); syncPosition() })
  audio.addEventListener('durationchange', () => { state.duration = audio.duration || 0; emit() })
  audio.addEventListener('play', () => { state.playing = true; emit(); syncMediaSession('playing') })
  audio.addEventListener('pause', () => { state.playing = false; emit(); syncMediaSession('paused') })
  audio.addEventListener('ended', () => { state.playing = false; state.currentTime = 0; emit(); syncMediaSession('none') })
  audio.addEventListener('error', () => {
    if (state.loading) return // 还在切源，别误报
    state.error = '播放中断'; emit()
  })
  initMediaSession()
  return audio
}

// ── Media Session：锁屏/通知栏媒体卡片显示歌名+歌手+封面 ──
// 原生 APK（yanji-native）：WebView 不支持 Web MediaSession API，通过 YanjiNative JS bridge
// 调 Kotlin 的 MediaNotificationHelper（真正的 Android MediaSession + MediaStyle 通知）。
// 浏览器/PWA：走原有 navigator.mediaSession 路径。
const APP_ART = 'https://sunmoon-orbit.github.io/ripple-and-serena/yanji/icon-512.png'
function isNativeApp() { return !!window.YanjiNative?.isNative?.() }

// 原生 app 的通知栏按钮回调入口（MainActivity 通过 evaluateJavascript 调用）
window.__yanjiMediaAction = (action) => {
  if (!audio) return
  if (action === 'play') audio.play().catch(() => {})
  else if (action === 'pause') audio.pause()
  else if (action === 'stop') stop()
  else if (action.startsWith('seek:')) { const ms = parseInt(action.slice(5)); if (isFinite(ms)) seek(ms / 1000) }
}

function initMediaSession() {
  if (isNativeApp()) return // 原生 app 的 action handler 在 Kotlin 侧注册
  if (!('mediaSession' in navigator)) return
  const reg = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn) } catch {} }
  reg('play', () => audio && audio.play().catch(() => {}))
  reg('pause', () => audio && audio.pause())
  reg('stop', () => stop())
  reg('seekto', (d) => { if (d.seekTime != null) seek(d.seekTime) })
  reg('previoustrack', () => seek(0))
}
function syncMediaSession(playbackState) {
  if (isNativeApp()) {
    if (!state.track) return
    try {
      const posMs = Math.round((audio?.currentTime || 0) * 1000)
      const durMs = Math.round((audio?.duration || 0) * 1000)
      window.YanjiNative.updateNowPlaying(
        state.track.name || '未知曲目',
        state.track.artist || '涟言点的歌',
        state.track.cover || APP_ART,
        playbackState === 'playing',
        posMs, durMs
      )
    } catch {}
    return
  }
  if (!('mediaSession' in navigator)) return
  try {
    if (playbackState === 'playing') initMediaSession()
    navigator.mediaSession.playbackState = playbackState
    if (state.track) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: state.track.name || '未知曲目',
        artist: state.track.artist || '涟言点的歌',
        album: '言叽',
        artwork: [{ src: state.track.cover || APP_ART, sizes: '512x512' }],
      })
    }
  } catch {}
}
let lastNativePos = 0
function syncPosition() {
  if (isNativeApp()) {
    const now = Date.now()
    if (now - lastNativePos < 1000) return
    lastNativePos = now
    if (!state.track || !audio || !isFinite(audio.duration) || audio.duration <= 0) return
    try {
      window.YanjiNative.updateNowPlaying(
        state.track.name || '未知曲目',
        state.track.artist || '涟言点的歌',
        state.track.cover || APP_ART,
        state.playing,
        Math.round(audio.currentTime * 1000),
        Math.round(audio.duration * 1000)
      )
    } catch {}
    return
  }
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return
  try {
    if (audio && isFinite(audio.duration) && audio.duration > 0) {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        position: Math.min(audio.currentTime, audio.duration),
        playbackRate: audio.playbackRate || 1,
      })
    }
  } catch {}
}

export function getState() { return { ...state } }

export function subscribe(fn) {
  listeners.add(fn)
  fn({ ...state })
  return () => listeners.delete(fn)
}

// meta: {name, artist, reason?, source?, id?, pic_id?, lyric_id?}
export async function playTrack(meta) {
  ensureAudio()
  state.loading = true
  state.error = ''
  state.lyrics = []
  emit()
  try {
    const resolved = await resolvePlayable(meta)
    if (!resolved || !resolved.url) {
      state.loading = false
      state.error = '这首几个源都没找到能放的版本'
      emit()
      return null
    }
    state.track = resolved
    audio.src = resolved.url
    await audio.play()
    state.loading = false
    emit()
    // 歌词异步补
    getLyric(resolved.source, resolved.lyric_id || resolved.id)
      .then((lrc) => { state.lyrics = lrc; emit() })
      .catch(() => {})
    return resolved
  } catch (e) {
    state.loading = false
    state.error = e?.message || '播放失败'
    emit()
    return null
  }
}

export function togglePlay() {
  if (!audio || !state.track) return
  if (audio.paused) audio.play().catch(() => {})
  else audio.pause()
}

export function seek(t) {
  if (!audio) return
  audio.currentTime = t
  state.currentTime = t
  emit()
}

export function stop() {
  if (!audio) return
  audio.pause()
  audio.currentTime = 0
  state.track = null
  state.lyrics = []
  emit()
  if (isNativeApp()) {
    try { window.YanjiNative.clearNowPlaying() } catch {}
  } else if ('mediaSession' in navigator) {
    try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none' } catch {}
  }
}

export function usePlayer() {
  const [s, setS] = useState(() => getState())
  useEffect(() => subscribe(setS), [])
  return s
}
