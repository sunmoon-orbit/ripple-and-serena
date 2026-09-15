import { useMessageSpeech } from '../Chat/useMessageSpeech'
import SpeechButton from '../Chat/SpeechButton'
import { canReadMessage } from './messages.mjs'

export default function CrossingMessage({ message, config, stopEpoch }) {
  const speech = useMessageSpeech(message.text, config, canReadMessage(message), stopEpoch)
  return <div className={'crossing-bubble ' + (message.role === 'user' ? 'bubble-user' : 'bubble-assistant')}>
    <div className="bubble-text">{message.text}{message.streaming && <span className="crossing-caret" />}</div>
    {message.previews?.map((url, i) => <img className="crossing-preview" key={i} src={url} alt="图片附件" />)}
    {message.role === 'assistant' && config?.enabled && <div className="crossing-speech"><SpeechButton status={speech.status} onClick={speech.toggle} disabled={!speech.available} error={speech.error} /></div>}
  </div>
}
