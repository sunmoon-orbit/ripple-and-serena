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

// ── Media Session：锁屏/通知栏媒体卡片显示歌名+歌手+封面，而不是光秃秃的「言叽」──
// 注意：只注册用得上的动作。不注册 next/prev，系统就不会画那两个没用的按钮。
const APP_ART = 'https://sunmoon-orbit.github.io/ripple-and-serena/yanji/icon-512.png' // 绝对URL（推送图标的教训）
function initMediaSession() {
  if (!('mediaSession' in navigator)) return
  // 每个 action 单独 try：某个不支持不能连累后面的（曾整块 try 导致 seekto 挂掉波及无从排查）
  const reg = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn) } catch {} }
  reg('play', () => audio && audio.play().catch(() => {}))
  reg('pause', () => audio && audio.pause())
  reg('stop', () => stop())
  reg('seekto', (d) => { if (d.seekTime != null) seek(d.seekTime) })
  reg('previoustrack', () => seek(0)) // 单曲播放器没队列：上一首=重头来
}
function syncMediaSession(playbackState) {
  if (!('mediaSession' in navigator)) return
  try {
    // 每次进入播放态重挂 handler：部分安卓 Chrome 会在会话重建后丢掉早先注册的 handler
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
  } catch { /* 元数据失败不影响播放 */ }
}
function syncPosition() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return
  try {
    if (audio && isFinite(audio.duration) && audio.duration > 0) {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        position: Math.min(audio.currentTime, audio.duration),
        playbackRate: audio.playbackRate || 1,
      })
    }
  } catch { /* 忽略 */ }
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
  if ('mediaSession' in navigator) {
    try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none' } catch {}
  }
}

export function usePlayer() {
  const [s, setS] = useState(() => getState())
  useEffect(() => subscribe(setS), [])
  return s
}
