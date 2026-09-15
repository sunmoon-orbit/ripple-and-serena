export default function SpeechButton({ status, onClick, disabled = false, error = '' }) {
  const label = disabled ? '回复完成后可朗读' : status === 'loading' ? '取消朗读加载' : status === 'playing' ? '暂停朗读' : status === 'paused' ? '继续朗读' : status === 'error' ? '朗读失败，点击重试' : '朗读'
  return <><button className={`msg-tts-btn${status !== 'idle' ? ' active' : ''}`} onClick={onClick} disabled={disabled} title={label} aria-label={label}>
    {status === 'loading' ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      : status === 'playing' ? <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>}
  </button>{error && <small className="msg-tts-error" role="status">{error}</small>}</>
}
