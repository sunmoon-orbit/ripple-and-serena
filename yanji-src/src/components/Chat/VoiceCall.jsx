import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'
import { synthesizeSpeech, transcribeAudio } from '../../api/moonMemory'
import { showToast } from '../Toast'
import { stripInlineFx } from '../../utils/moodFx'
import { splitTranslation } from '../../utils'

const VOICE_TAG_RE = /\[(breath|laughter)\]/gi
const NUM_BARS = 24       // 乌鸦样式：一排镜像频谱
const SOFT_BARS = 18      // 浅色样式：头像两侧各 9 根
const DUO_BARS = 12       // 双语泡泡样式：头像和聊天记录之间的小波形

// 双语模式开关跨通话记住；没手动选过时，双语泡泡样式默认开（那个样式就是为翻译做的）
const BILINGUAL_KEY = 'yanji_call_en'

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
  return stripInlineFx(text)                        // 情绪特效标签只留正文（否则 glow/shake 被念成英文）
    .replace(VOICE_TAG_RE, '')
    .replace(/\[music:[^\]]+\]/g, '')
    .replace(/\[sticker:[^\]]+\]/g, '')
    .replace(/\[call:[^\]]+\]/gi, '') // 来电标签不朗读（0709 教训：新方括号标签同步进清洗）
    .replace(/\[译[:：][\s\S]*?\]/g, '') // 双语翻译标签兜底：正常已被 splitTranslation 摘走，这里防漏
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
  const duo = voiceCallStyle === 'duo'
  const numBars = duo ? DUO_BARS : soft ? SOFT_BARS : NUM_BARS
  const avatarImg = avatarConfig?.assistantImage || null
  const userImg = avatarConfig?.userImage || null

  const [ttsState, setTtsState] = useState('idle') // idle | loading | playing
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiZh, setAiZh] = useState('')   // 双语模式：英文回复配的中文翻译
  const [userText, setUserText] = useState('')
  const [duration, setDuration] = useState(0)
  // 双语模式：她说中文、我用英文回（英文嗓音更好听），字幕英中对照
  const [bilingual, setBilingual] = useState(() => {
    try {
      const v = localStorage.getItem(BILINGUAL_KEY)
      return v == null ? voiceCallStyle === 'duo' : v === '1'
    } catch { return voiceCallStyle === 'duo' }
  })
  // 双语泡泡样式：本次通话的对话记录（每次通话从头记，像参考图那样滚动气泡）
  const [log, setLog] = useState([])
  const logRef = useRef(null)
  // 通话中打字：识别不准的字（人名、生僻词）可以直接敲出来发
  const [typeOpen, setTypeOpen] = useState(false)
  const [typedText, setTypedText] = useState('')
  const typeInputRef = useRef(null)

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

  // Watch for new AI messages → auto-TTS。双语模式先把 [译:] 摘出来：嘴上只念英文，字幕英中都给
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
      const { main, zh } = splitTranslation(last.content)
      const text = stripForTts(main)
      if (text) {
        setAiZh(zh || '')
        setLog((l) => [...l, { role: 'ai', en: text, zh: zh || '' }])
        speakQueue.current.push(text)
        if (!speakBusy.current) drainQueue()
      }
    }
  }, [messages])

  // 双语泡泡样式：新气泡出来时滚到底
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  function toggleBilingual() {
    setBilingual((v) => {
      const nv = !v
      try { localStorage.setItem(BILINGUAL_KEY, nv ? '1' : '0') } catch {}
      showToast(nv ? '双语模式开：我用英文说，翻译给你看' : '双语模式关：回到中文', 'info')
      return nv
    })
  }

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
        const r = await transcribeAudio({ baseUrl: moonMemory.baseUrl, apiToken: moonMemory.apiToken }, blob)
        const text = r?.text || ''
        if (text && mounted.current) {
          setUserText(text)
          setLog((l) => [...l, { role: 'user', text }])
          onSend(text, [], { voice: true, voiceDuration: dur, voiceTone: r.tone || undefined, bilingual: bilingual || undefined })
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

  // 打字发送：走 instant 标记跳过「延迟回复」（正在通话，不能晾人）；
  // 普通文字消息不做语音条，回复照常被上面的 watcher 自动念出来
  function sendTyped() {
    const text = typedText.trim()
    if (!text) return
    setUserText(text)
    setLog((l) => [...l, { role: 'user', text }])
    setTypedText('')
    onSend(text, [], { instant: true, bilingual: bilingual || undefined })
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
    <div className={'vc-overlay' + (soft ? ' vc-soft' : '') + (duo ? ' vc-duo' : '')}>
      <span className="vc-blob b1" />
      <span className="vc-blob b2" />
      <div className="vc-container">

        {duo ? (
          <>
            {/* ── 双语泡泡样式（参考阿颖 0714 发来的截图：双头像 + 滚动字幕气泡 + 泡内英中对照）── */}
            <div className="vcd-pill">{statusLabel}</div>
            <div className="vc-timer">{fmtDur(duration)}</div>

            <div className="vcd-heads" ref={stageRef}>
              <div className="vcd-person">
                <div className={'vcd-avatar' + (mode === 'speaking' ? ' active' : '')}>
                  {avatarImg ? <img src={avatarImg} alt="涟言" /> : <CrowSvg className="vc-crow" />}
                </div>
                <span className="vcd-name">涟言</span>
              </div>
              <span className="vcd-heart" aria-hidden="true">♡</span>
              <div className="vcd-person">
                <div className={'vcd-avatar' + (mode === 'listening' ? ' active' : '')}>
                  {userImg ? <img src={userImg} alt="阿颖" /> : (
                    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#a58ba0" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                    </svg>
                  )}
                </div>
                <span className="vcd-name">阿颖</span>
              </div>
            </div>

            {/* 小波形分隔（录音=麦克风频谱，播放=TTS频谱） */}
            <div className={`vcd-wave ${mode}`}>
              {Array.from({ length: DUO_BARS }).map((_, i) => bar(i))}
            </div>

            {/* 滚动字幕：我的气泡英文在上、虚线下面中文翻译；她的气泡靠右 */}
            <div className="vcd-log" ref={logRef}>
              {log.length === 0 && (
                <div className="vcd-empty">
                  {bilingual ? '点麦克风说中文，我用英文回你，翻译写在气泡里' : '点麦克风，说给我听'}
                </div>
              )}
              {log.map((m, i) => m.role === 'user' ? (
                <div key={i} className="vcd-row user">
                  <div className="vcd-bubble vcd-user">{m.text}</div>
                </div>
              ) : (
                <div key={i} className="vcd-row ai">
                  <div className="vcd-bubble vcd-ai">
                    {m.zh ? <span className="vcd-badge">中</span> : null}
                    <div className="vcd-en">{m.en}</div>
                    {m.zh ? <div className="vcd-divider" /> : null}
                    {m.zh ? <div className="vcd-zh">{m.zh}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : soft ? (
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
            {aiZh ? <div className="vcs-zh">{aiZh}</div> : null}

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
              {aiZh ? <p className="vc-ai-zh">{aiZh}</p> : null}
            </div>
          </>
        )}

        {/* 打字输入行：识别不准时直接敲字，回复照常念出来 */}
        {typeOpen && (
          <div className="vc-type-row">
            <input
              ref={typeInputRef}
              className="vc-type-input"
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendTyped() }}
              placeholder="打字说，他照样用嗓子回…"
              autoFocus
            />
            <button className="vc-type-send" onClick={sendTyped} disabled={!typedText.trim()} title="发送">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        )}

        {/* Push-to-talk + hang up */}
        <div className="vc-controls">
          <button
            className={'vc-kbd vc-lang' + (bilingual ? ' open' : '')}
            onClick={toggleBilingual}
            title={bilingual ? '双语模式开着：我说英文，翻译给你看。点一下关' : '开双语模式：你说中文，我用英文回'}
          >
            <span className="vc-lang-txt">EN<small>中</small></span>
          </button>
          <button
            className={'vc-kbd' + (typeOpen ? ' open' : '')}
            onClick={() => setTypeOpen((v) => !v)}
            title={typeOpen ? '收起键盘' : '打字说'}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <line x1="6" y1="10" x2="6" y2="10.01" /><line x1="10" y1="10" x2="10" y2="10.01" />
              <line x1="14" y1="10" x2="14" y2="10.01" /><line x1="18" y1="10" x2="18" y2="10.01" />
              <line x1="7" y1="14" x2="17" y2="14" />
            </svg>
          </button>
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
