import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { synthesizeSpeech, transcribeAudio } from '../../api/moonMemory'
import { showToast } from '../Toast'

const VOICE_TAG_RE = /\[(breath|laughter)\]/gi
const NUM_BARS = 24       // 乌鸦样式：一排镜像频谱
const SOFT_BARS = 18      // 浅色样式：头像两侧各 9 根

// 像素乌鸦（两种样式共用：乌鸦样式当主角，浅色样式没设头像时兜底）
function CrowSvg({ className }) {
  return (
    <svg className={className} viewBox="-2.5 2.5 20 14.5" aria-hidden="true">
      <g className="vcw-body">
        <rect x="2" y="6" width="11" height="7" fill="#2E2B29" />
        <rect x="5.5" y="5" width="4" height="1" fill="#2E2B29" />
        <rect x="6.5" y="4.2" width="1" height="1" fill="#2E2B29" />
        <g className="vcw-wl"><rect x="0" y="9" width="2" height="2.4" fill="#211F1D" /></g>
        <g className="vcw-wr"><rect x="13" y="9" width="2" height="2.4" fill="#211F1D" /></g>
        <g className="vcw-eye" fill="#F5F0E8">
          <rect x="4" y="8" width="1.2" height="1.8" />
          <rect x="9.8" y="8" width="1.2" height="1.8" />
        </g>
        <g className="vcw-beak"><path d="M6.7 10.6 L8.3 10.6 L7.5 12 Z" fill="#DA7756" /></g>
        <g fill="#DA7756">
          <rect x="4.5" y="13" width="1" height="2" />
          <rect x="9.5" y="13" width="1" height="2" />
        </g>
      </g>
    </svg>
  )
}

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
  const { moonMemory, activeChatId, messagesByChatId, voiceCallStyle, avatarConfig } = useStore()
  const messages = messagesByChatId[activeChatId] || []

  const soft = voiceCallStyle === 'soft'
  const numBars = soft ? SOFT_BARS : NUM_BARS
  const avatarImg = avatarConfig?.assistantImage || null

  const [ttsState, setTtsState] = useState('idle') // idle | loading | playing
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [aiText, setAiText] = useState('')
  const [userText, setUserText] = useState('')
  const [duration, setDuration] = useState(0)

  const recRef = useRef(null)
  const recChunks = useRef([])
  const ttsCtxRef = useRef(null)
  const lastTtsId = useRef(null)
  const speakQueue = useRef([])
  const speakBusy = useRef(false)
  const mounted = useRef(true)

  // 音频可视化：一个 analyser 两用（录音时接麦克风、播放时串在 TTS 链路上）
  const analyserRef = useRef(null)
  const micSrcRef = useRef(null)
  const rafRef = useRef(0)
  const barsRef = useRef([])
  const stageRef = useRef(null)

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
      cancelAnimationFrame(rafRef.current)
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

  // ── 可视化 ──
  function getAnalyser() {
    const ctx = ttsCtxRef.current
    if (!ctx) return null
    if (!analyserRef.current || analyserRef.current.context !== ctx) {
      const an = ctx.createAnalyser()
      an.fftSize = 128
      an.smoothingTimeConstant = 0.72
      analyserRef.current = an
    }
    return analyserRef.current
  }

  function startViz() {
    cancelAnimationFrame(rafRef.current)
    const an = analyserRef.current
    if (!an) return
    const data = new Uint8Array(an.frequencyBinCount)
    const half = (numBars - 1) / 2
    const loop = () => {
      an.getByteFrequencyData(data)
      let sum = 0
      for (let i = 0; i < numBars; i++) {
        // 频谱镜像铺开：低频在中间、高频往两边，看起来像呼吸开花
        const t = Math.abs(i - half) / half
        const bin = Math.min(data.length - 1, Math.floor(2 + t * data.length * 0.72))
        const v = data[bin] / 255
        sum += v
        const el = barsRef.current[i]
        if (el) el.style.height = `${5 + Math.round(v * 40)}px`
      }
      stageRef.current?.style.setProperty('--vc-level', (sum / numBars).toFixed(3))
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  function stopViz() {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    barsRef.current.forEach((el) => { if (el) el.style.height = '' })
    stageRef.current?.style.setProperty('--vc-level', '0')
  }

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
      try { micSrcRef.current?.disconnect() } catch {}
      micSrcRef.current = null
      stopViz()
      setRecording(false)
      const dur = Math.round((Date.now() - recStart) / 1000)
      const blob = new Blob(recChunks.current, { type: mr.mimeType || 'audio/webm' })
      if (blob.size < 1200) { showToast('录音太短了，再说一次', 'info'); return }
      setTranscribing(true)
      try {
        const text = await transcribeAudio({ baseUrl: moonMemory.baseUrl, apiToken: moonMemory.apiToken }, blob)
        if (text && mounted.current) {
          setUserText(text)
          onSend(text, [], { voice: true, voiceDuration: dur })
        } else if (!text) showToast('没识别到内容，再说一次', 'info')
      } catch (e) {
        showToast(e.message || '转写失败', 'error', 5000)
      } finally {
        if (mounted.current) setTranscribing(false)
      }
    }
    recRef.current = mr
    mr.start()
    setRecording(true)
    // 麦克风接进 analyser（不接 destination，不会自听回声）
    const an = getAnalyser()
    if (an && ttsCtxRef.current) {
      try {
        micSrcRef.current = ttsCtxRef.current.createMediaStreamSource(stream)
        micSrcRef.current.connect(an)
        startViz()
      } catch {}
    }
  }

  async function drainQueue() {
    speakBusy.current = true
    while (speakQueue.current.length && mounted.current) {
      const text = speakQueue.current.shift()
      if (mounted.current) { setAiText(text); setTtsState('loading') }
      try { await speakOne(text) } catch {}
    }
    // 说完保留字幕（淡显），只把状态归位
    if (mounted.current) setTtsState('idle')
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
      const an = getAnalyser()
      if (an) {
        try { source.connect(an); an.connect(ctx.destination); startViz() }
        catch { source.connect(ctx.destination) }
      } else {
        source.connect(ctx.destination)
      }
      const finish = () => {
        try { an?.disconnect() } catch {}
        stopViz()
        resolve()
      }
      source.start(0)
      const safety = setTimeout(finish, audioBuf.duration * 1000 + 2000)
      source.onended = () => { clearTimeout(safety); finish() }
    })
  }

  function handleClose() {
    try { recRef.current?.stop() } catch {}
    onClose()
  }

  const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const statusLabel = transcribing ? '在听清你说的话…'
    : recording ? '我听着呢，说完点一下'
    : ttsState === 'loading' ? '正想着怎么开口…'
    : ttsState === 'playing' ? '在跟你说话'
    : '点麦克风，说给我听'

  const mode = ttsState === 'playing' ? 'speaking'
    : recording ? 'listening'
    : (transcribing || ttsState === 'loading') ? 'thinking'
    : 'idle'

  const bar = (i) => (
    <div
      key={i}
      className="vc-bar"
      ref={(el) => { barsRef.current[i] = el }}
      style={{ animationDelay: `${(i % 6) * 0.18}s` }}
    />
  )

  return createPortal(
    <div className={'vc-overlay' + (soft ? ' vc-soft' : '')}>
      <span className="vc-blob b1" />
      <span className="vc-blob b2" />
      <div className="vc-container">

        {soft ? (
          <>
            {/* ── 浅色头像样式 ── */}
            <div className={`vcs-head ${mode}`} ref={stageRef}>
              <div className="vcs-strip">
                {Array.from({ length: SOFT_BARS / 2 }).map((_, i) => bar(i))}
              </div>
              <div className="vcs-avatar-wrap">
                <div className="vcs-ring" />
                <div className="vcs-avatar">
                  {avatarImg
                    ? <img src={avatarImg} alt="涟言" />
                    : <CrowSvg className="vc-crow" />}
                </div>
              </div>
              <div className="vcs-strip">
                {Array.from({ length: SOFT_BARS / 2 }).map((_, i) => bar(SOFT_BARS / 2 + i))}
              </div>
            </div>

            <div className="vcs-name">涟言</div>
            <div className="vcs-status">{statusLabel}</div>
            <div className="vc-timer">{fmtDur(duration)}</div>

            {aiText ? (
              <div className={'vcs-quote' + (mode === 'speaking' || ttsState === 'loading' ? '' : ' done')}>{aiText}</div>
            ) : (
              <div className="vcs-quote vcs-quote-empty">…</div>
            )}

            <div className="vcs-caption-label">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="4" y1="10" x2="4" y2="14" /><line x1="9" y1="7" x2="9" y2="17" />
                <line x1="14" y1="10" x2="14" y2="14" /><line x1="19" y1="8" x2="19" y2="16" />
              </svg>
              实时字幕 · live transcript
            </div>
            <div className="vcs-pill">{userText || '你说的话会出现在这里'}</div>
          </>
        ) : (
          <>
            {/* ── 像素乌鸦样式 ── */}
            <div className="vc-name">涟言</div>
            <div className="vc-timer">{fmtDur(duration)}</div>

            {/* 像素乌鸦 + 呼吸光圈 */}
            <div className={`vc-stage ${mode}`} ref={stageRef}>
              <div className="vc-orb" />
              <CrowSvg className="vc-crow" />
            </div>

            <div className="vc-status">{statusLabel}</div>

            {/* 真·音频波形（录音=麦克风频谱，播放=TTS频谱） */}
            <div className={`vc-wave ${mode}`}>
              {Array.from({ length: NUM_BARS }).map((_, i) => bar(i))}
            </div>

            {/* 字幕区：她说的 + 我说的 */}
            <div className="vc-text-area">
              {userText ? <p className="vc-user-text">「{userText}」</p> : null}
              {aiText ? (
                <p className={'vc-ai-text' + (mode === 'speaking' || ttsState === 'loading' ? '' : ' done')}>{aiText}</p>
              ) : null}
            </div>
          </>
        )}

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
