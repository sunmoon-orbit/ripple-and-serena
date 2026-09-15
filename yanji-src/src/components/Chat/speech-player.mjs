// Shared by Murmur and Crossing; dependencies are faked in tests.
let activePlayer = null
export function createSpeechPlayer({ synthesize, createAudio = url => new Audio(url), changed = () => {} }) {
  let audio = null, abort = null, cancelLoad = null, version = 0
  let state = { status: 'idle', duration: 0, error: '' }
  const update = patch => { state = { ...state, ...patch }; changed(state) }
  const stop = () => {
    ++version
    abort?.abort(); abort = null
    cancelLoad?.(); cancelLoad = null
    if (audio) {
      audio.onended = audio.onerror = audio.onloadedmetadata = null
      audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null
    }
    if (activePlayer === stop) activePlayer = null
    update({ status: 'idle', error: '', duration: 0 })
  }
  return {
    get state() { return state },
    stop,
    async toggle() {
      if (state.status === 'loading') { stop(); return }
      if (state.status === 'playing') { audio?.pause(); update({ status: 'paused' }); return }
      if (activePlayer && activePlayer !== stop) activePlayer()
      activePlayer = stop
      const current = ++version
      try {
        if (!audio) {
          update({ status: 'loading', error: '' })
          abort = new AbortController()
          const result = await synthesize(abort.signal)
          if (current !== version) return
          audio = createAudio(result.audio)
          const loadingAudio = audio
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => finish(new Error('timeout')), 20000)
            const finish = error => {
              clearTimeout(timer); cancelLoad = null
              loadingAudio.onloadedmetadata = null
              loadingAudio.onerror = null
              error ? reject(error) : resolve()
            }
            cancelLoad = () => finish(new Error('cancelled'))
            loadingAudio.onloadedmetadata = () => finish()
            loadingAudio.onerror = () => finish(new Error('audio'))
            if (loadingAudio.readyState >= 1) finish()
          })
          if (current !== version) return
          audio.onended = () => { audio.currentTime = 0; update({ status: 'idle' }) }
          audio.onerror = () => { stop(); update({ status: 'error', error: '朗读失败，请重试' }) }
          update({ duration: audio.duration || 0 })
        }
        const playingAudio = audio
        await playingAudio.play()
        if (current !== version) { playingAudio.pause(); return }
        update({ status: 'playing', error: '' })
      } catch {
        if (current !== version) return
        stop()
        update({ status: 'error', error: '朗读失败，请重试' })
      }
    },
  }
}
