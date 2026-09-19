import { useCallback, useState } from 'react'
import { useMessageSpeech } from '../Chat/useMessageSpeech'
import SpeechButton from '../Chat/SpeechButton'
import { canReadMessage } from './messages.mjs'

export default function CrossingMessage({ message, config, stopEpoch }) {
  const speech = useMessageSpeech(message.text, config, canReadMessage(message), stopEpoch)
  const [voiceMode, setVoiceMode] = useState(false)
  const playSpeech = useCallback(() => {
    if (!speech.available) return
    setVoiceMode(true)
    return speech.toggle()
  }, [speech.available, speech.toggle])
  const exitVoiceMode = useCallback(() => {
    speech.stop()
    setVoiceMode(false)
  }, [speech.stop])
  const formatDuration = seconds => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
  return <div className={'crossing-bubble ' + (message.role === 'user' ? 'bubble-user' : 'bubble-assistant')}>
    {voiceMode ? <div className={`vb-wrap crossing-voice${speech.status === 'playing' ? ' playing' : ''}`}>
      <div className={`voice-bar${speech.status === 'playing' ? ' playing' : ''}`}>
        <button className="vb-play" onClick={playSpeech} aria-label={speech.status === 'playing' ? '暂停朗读' : speech.status === 'paused' ? '继续朗读' : speech.status === 'loading' ? '取消朗读加载' : speech.status === 'error' ? '朗读失败，点击重试' : '朗读'}>
          {speech.status === 'loading' ? <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="4" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="20" cy="12" r="2"/></svg>
            : speech.status === 'playing' ? <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              : <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>}
        </button>
        <div className="vb-wave" onClick={exitVoiceMode} title="点击切回文字">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="vb-bar" />)}
        </div>
        <span className="vb-time">{speech.duration ? formatDuration(speech.duration) : '…'}</span>
      </div>
      {speech.error && <small className="msg-tts-error" role="status">{speech.error}</small>}
    </div> : <div className="bubble-text">{message.text}{message.streaming && <span className="crossing-caret" />}</div>}
    {message.previews?.map((url, i) => <img className="crossing-preview" key={i} src={url} alt="图片附件" />)}
    {message.role === 'assistant' && config?.enabled && !voiceMode && <div className="crossing-speech"><SpeechButton status={speech.status} onClick={playSpeech} disabled={!speech.available} error={speech.error} /></div>}
  </div>
}
