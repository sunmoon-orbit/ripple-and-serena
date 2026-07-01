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
  audio.addEventListener('timeupdate', () => { state.currentTime = audio.currentTime; emit() })
  audio.addEventListener('durationchange', () => { state.duration = audio.duration || 0; emit() })
  audio.addEventListener('play', () => { state.playing = true; emit() })
  audio.addEventListener('pause', () => { state.playing = false; emit() })
  audio.addEventListener('ended', () => { state.playing = false; state.currentTime = 0; emit() })
  audio.addEventListener('error', () => {
    if (state.loading) return // 还在切源，别误报
    state.error = '播放中断'; emit()
  })
  return audio
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
}

export function usePlayer() {
  const [s, setS] = useState(() => getState())
  useEffect(() => subscribe(setS), [])
  return s
}
