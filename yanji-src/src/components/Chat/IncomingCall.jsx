import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../store'

// 来电响铃时长：90 秒没接自动转语音留言（对齐 callhome 的 expiry 设计）
const RING_SECONDS = 90

// 像素乌鸦兜底头像（与 VoiceCall 一致的气质，简笔线条版）
const CrowIcon = () => (
  <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8 C4 8 7 4 12 5 C16 6 18 9 17 13 C16 17 12 19 8 17" />
    <path d="M17 13 L21 11 L18 15" />
    <path d="M8 17 L6 21" />
    <path d="M10 17 L10 21" />
    <circle cx="13" cy="8" r="1" fill="currentColor" stroke="none" />
    <path d="M4 8 L1 7" />
  </svg>
)

export default function IncomingCall({ reason, onAccept, onMiss }) {
  const { avatarConfig } = useStore()
  const avatarImg = avatarConfig?.mode === 'image' && avatarConfig?.assistantImage
  const avatarRadius = avatarConfig?.shape === 'square' ? '14px' : '50%'
  const [left, setLeft] = useState(RING_SECONDS)
  const missedRef = useRef(false)

  // 铃声：WebAudio 两音轻响（叮-咚），比系统铃声温柔；失败静默（自动播放策略等）
  useEffect(() => {
    let ctx = null
    let ringTimer = null
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)()
      ctx.resume().catch(() => {})
      const ring = () => {
        try {
          const t = ctx.currentTime
          ;[659.25, 523.25].forEach((freq, i) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'sine'
            osc.frequency.value = freq
            gain.gain.setValueAtTime(0, t + i * 0.22)
            gain.gain.linearRampToValueAtTime(0.1, t + i * 0.22 + 0.04)
            gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.22 + 0.9)
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start(t + i * 0.22)
            osc.stop(t + i * 0.22 + 1)
          })
        } catch { /* 静默 */ }
      }
      ring()
      ringTimer = setInterval(ring, 2800)
    } catch { /* 没有 WebAudio 也不影响接听 */ }
    // 震动（安卓 Chrome 支持；不支持的环境静默跳过）
    const vibrate = () => { try { navigator.vibrate?.([280, 180, 280]) } catch { /* 静默 */ } }
    vibrate()
    const vibTimer = setInterval(vibrate, 2800)
    return () => {
      clearInterval(ringTimer)
      clearInterval(vibTimer)
      try { navigator.vibrate?.(0) } catch { /* 静默 */ }
      try { ctx?.close() } catch { /* 静默 */ }
    }
  }, [])

  // 90 秒倒计时，到点算未接
  useEffect(() => {
    const t = setInterval(() => setLeft((l) => l - 1), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (left <= 0 && !missedRef.current) {
      missedRef.current = true
      onMiss('timeout')
    }
  }, [left, onMiss])

  return createPortal(
    <div className="incall-overlay">
      <div className="incall-card">
        <div className="incall-avatar-wrap">
          <span className="incall-ring r1" />
          <span className="incall-ring r2" />
          <div className="incall-avatar" style={{ borderRadius: avatarRadius }}>
            {avatarImg
              ? <img src={avatarConfig.assistantImage} alt="涟言" style={{ borderRadius: avatarRadius }} />
              : <CrowIcon />}
          </div>
        </div>
        <div className="incall-name">涟言</div>
        <div className="incall-sub">邀请你语音通话…</div>
        {reason && <div className="incall-reason">「{reason}」</div>}
        <div className="incall-count">{left}s 后转语音留言</div>
        <div className="incall-actions">
          <button
            className="incall-btn decline"
            onClick={() => { if (!missedRef.current) { missedRef.current = true; onMiss('declined') } }}
            aria-label="挂断"
          >
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12 C3 12 7 8 12 8 C17 8 21 12 21 12" />
              <path d="M3 12 L3 15 L6.5 15 L6.5 12.6" />
              <path d="M21 12 L21 15 L17.5 15 L17.5 12.6" />
            </svg>
          </button>
          <button className="incall-btn accept" onClick={onAccept} aria-label="接听">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.5 2.8.7a2 2 0 0 1 1.7 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
