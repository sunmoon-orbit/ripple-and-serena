import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { synthesizeSpeech, transcribeAudio } from '../../api/moonMemory'
import { showToast } from '../Toast'

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
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [aiText, setAiText] = useState('')
  const [duration, setDuration] = useState(0)

  const recRef = useRef(null)
  const recChunks = useRef([])
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
      try { recRef.current?.stop() } catch {}
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

  // ── 录音转写（push-to-talk）：点一下开始，再点一下结束并发送 ──
  async function toggleRecord() {
    if (transcribing) return
    if (recording) { // 停止 → onstop 转写
      try { recRef.current?.stop() } catch {}
      return
    }
    if (ttsState !== 'idle') return // 对方说话时不录
    if (!moonMemory?.apiToken) { showToast('语音通话需要先连接记忆库', 'error'); return }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      showToast('当前浏览器不支持录音', 'error'); return
    }
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      showToast('麦克风打不开：' + (e.message || e.name), 'error', 5000); return
    }
    const mr = new MediaRecorder(stream)
    recChunks.current = []
    const recStart = Date.now()
    mr.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.current.push(e.data) }
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      setRecording(false)
      const dur = Math.round((Date.now() - recStart) / 1000)
      const blob = new Blob(recChunks.current, { type: mr.mimeType || 'audio/webm' })
      if (blob.size < 1200) { showToast('录音太短了，再说一次', 'info'); return }
      setTranscribing(true)
      try {
        const text = await transcribeAudio({ baseUrl: moonMemory.baseUrl, apiToken: moonMemory.apiToken }, blob)
        if (text && mounted.current) onSend(text, [], { voice: true, voiceDuration: dur })
        else if (!text) showToast('没识别到内容，再说一次', 'info')
      } catch (e) {
        showToast(e.message || '转写失败', 'error', 5000)
      } finally {
        if (mounted.current) setTranscribing(false)
      }
    }
    recRef.current = mr
    mr.start()
    setRecording(true)
  }

  async function drainQueue() {
    speakBusy.current = true
    while (speakQueue.current.length && mounted.current) {
      const text = speakQueue.current.shift()
      if (mounted.current) { setAiText(text); setTtsState('loading') }
      try { await speakOne(text) } catch {}
    }
    if (mounted.current) { setAiText(''); setTtsState('idle') }
    speakBusy.current = false
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

  function handleClose() {
    try { recRef.current?.stop() } catch {}
    onClose()
  }

  const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const statusLabel = transcribing ? '识别中…'
    : recording ? '录音中…说完点一下发送'
    : ttsState === 'loading' ? '合成中…'
    : ttsState === 'playing' ? '对方说话中'
    : '点麦克风说话'

  const isPlaying = ttsState === 'playing'

  return createPortal(
    <div className="vc-overlay">
      <div className="vc-container">

        <div className="vc-timer">{fmtDur(duration)}</div>
        <div className="vc-status">{statusLabel}</div>

        {/* Waveform animation */}
        <div className={`vc-wave${isPlaying ? ' playing' : recording ? ' listening' : ''}`}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="vc-bar" style={{ animationDelay: `${i * 0.07}s` }} />
          ))}
        </div>

        {/* Text display */}
        <div className="vc-text-area">
          {aiText ? <p className="vc-ai-text">{aiText}</p> : null}
        </div>

        {/* Push-to-talk + hang up */}
        <div className="vc-controls">
          <button
            className={'vc-mic' + (recording ? ' recording' : '') + (transcribing ? ' busy' : '')}
            onClick={toggleRecord}
            disabled={transcribing || ttsState !== 'idle'}
            title={recording ? '点一下结束并发送' : '点一下开始说话'}
          >
            {transcribing ? (
              <svg className="vc-spin" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            ) : (
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            )}
          </button>

          <button className="vc-hangup" onClick={handleClose} title="挂断">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.27-.27.67-.36 1-.25 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.01L6.6 10.8z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
