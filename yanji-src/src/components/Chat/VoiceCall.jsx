import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { synthesizeSpeech } from '../../api/moonMemory'

const VOICE_TAG_RE = /\[(breath|laughter)\]/gi

function stripForTts(text) {
  return text
    .replace(VOICE_TAG_RE, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*`>_~\[\]]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 500)
}

export default function VoiceCall({ onClose, onSend }) {
  const { moonMemory, activeChatId, messagesByChatId } = useStore()
  const messages = messagesByChatId[activeChatId] || []

  const [ttsState, setTtsState] = useState('idle') // idle | loading | playing
  const [transcript, setTranscript] = useState('')
  const [aiText, setAiText] = useState('')
  const [duration, setDuration] = useState(0)

  const srRef = useRef(null)
  const srWanted = useRef(true)
  const ttsCtxRef = useRef(null)
  const lastTtsId = useRef(null)
  const speakQueue = useRef([])
  const speakBusy = useRef(false)
  const mounted = useRef(true)

  // Unlock AudioContext in the call-open gesture
  useEffect(() => {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    ctx.resume()
    const buf = ctx.createBuffer(1, 1, 22050)
    const src = ctx.createBufferSource()
    src.buffer = buf; src.connect(ctx.destination); src.start(0)
    ttsCtxRef.current = ctx

    return () => {
      mounted.current = false
      try { ttsCtxRef.current?.close() } catch {}
    }
  }, [])

  // Call duration timer
  useEffect(() => {
    const t = setInterval(() => setDuration(d => d + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Watch for new AI messages → auto-TTS
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (
      last &&
      last.role === 'assistant' &&
      !last.streaming &&
      last.content &&
      last.id !== lastTtsId.current
    ) {
      lastTtsId.current = last.id
      const text = stripForTts(last.content)
      if (text) {
        speakQueue.current.push(text)
        if (!speakBusy.current) drainQueue()
      }
    }
  }, [messages])

  function stopSr() {
    if (srRef.current) {
      try { srRef.current.stop() } catch {}
      srRef.current = null
    }
  }

  const startSr = useCallback(() => {
    if (!srWanted.current || !mounted.current) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    const sr = new SR()
    sr.lang = 'zh-CN'
    sr.continuous = true
    sr.interimResults = true
    sr.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = (e.results[i][0]?.transcript || '').trim()
        if (e.results[i].isFinal) {
          if (mounted.current) setTranscript('')
          if (piece) onSend(`[voice] ${piece}`, [])
        } else {
          interim += piece
        }
      }
      if (interim && mounted.current) setTranscript(interim)
    }
    sr.onend = () => {
      if (srWanted.current && mounted.current) setTimeout(startSr, 450)
    }
    sr.onerror = () => {
      if (srWanted.current && mounted.current) setTimeout(startSr, 1000)
    }
    sr.start()
    srRef.current = sr
  }, [onSend])

  async function drainQueue() {
    speakBusy.current = true
    stopSr()
    while (speakQueue.current.length && mounted.current) {
      const text = speakQueue.current.shift()
      if (mounted.current) { setAiText(text); setTtsState('loading') }
      try { await speakOne(text) } catch {}
    }
    if (mounted.current) { setAiText(''); setTtsState('idle') }
    speakBusy.current = false
    if (srWanted.current && mounted.current) setTimeout(startSr, 250)
  }

  async function speakOne(text) {
    const config = { baseUrl: moonMemory.baseUrl, apiToken: moonMemory.apiToken }
    const data = await synthesizeSpeech(config, text)
    const audioSrc = data.audio

    let ctx = ttsCtxRef.current
    if (!ctx || ctx.state === 'closed') {
      const AC = window.AudioContext || window.webkitAudioContext
      ctx = new AC()
      ttsCtxRef.current = ctx
    }
    if (ctx.state === 'suspended') await ctx.resume()

    const resp = await fetch(audioSrc)
    const arrayBuf = await resp.arrayBuffer()
    const audioBuf = await ctx.decodeAudioData(arrayBuf)

    if (!mounted.current) return
    setTtsState('playing')

    return new Promise((resolve) => {
      const source = ctx.createBufferSource()
      source.buffer = audioBuf
      source.connect(ctx.destination)
      source.start(0)
      const safety = setTimeout(resolve, audioBuf.duration * 1000 + 2000)
      source.onended = () => { clearTimeout(safety); resolve() }
    })
  }

  // Start recognition after mount
  useEffect(() => {
    const t = setTimeout(startSr, 600)
    return () => {
      clearTimeout(t)
      srWanted.current = false
      stopSr()
    }
  }, [startSr])

  function handleClose() {
    srWanted.current = false
    stopSr()
    onClose()
  }

  const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const statusLabel = ttsState === 'loading' ? '合成中…'
    : ttsState === 'playing' ? '对方说话中'
    : transcript ? '识别中…'
    : '倾听中…'

  const isListening = ttsState === 'idle'
  const isPlaying = ttsState === 'playing'

  return createPortal(
    <div className="vc-overlay">
      <div className="vc-container">

        <div className="vc-timer">{fmtDur(duration)}</div>
        <div className="vc-status">{statusLabel}</div>

        {/* Waveform animation */}
        <div className={`vc-wave${isPlaying ? ' playing' : isListening ? ' listening' : ''}`}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="vc-bar" style={{ animationDelay: `${i * 0.07}s` }} />
          ))}
        </div>

        {/* Text display */}
        <div className="vc-text-area">
          {aiText ? (
            <p className="vc-ai-text">{aiText}</p>
          ) : transcript ? (
            <p className="vc-transcript">{transcript}</p>
          ) : null}
        </div>

        {/* Hang up */}
        <button className="vc-hangup" onClick={handleClose} title="挂断">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.27-.27.67-.36 1-.25 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.01L6.6 10.8z"/>
          </svg>
        </button>
      </div>
    </div>,
    document.body
  )
}
