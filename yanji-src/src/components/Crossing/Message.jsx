import MessageBubble from '../Chat/MessageBubble'
import { canReadMessage } from './messages.mjs'
import { downloadBlob } from '../../utils/download'

export default function CrossingMessage({ message, config, stopEpoch }) {
  return <><MessageBubble
    msg={{
      id: message.id,
      role: message.role,
      content: message.text || '',
      images: message.previews,
      music: message.music,
      streaming: message.streaming,
      createdAt: message.createdAt,
    }}
    presentationConfig={config}
    speechReady={canReadMessage(message)}
    speechResetKey={stopEpoch}
  />{message.files?.map((file, i) => <button className="roost-btn crossing-file-card" key={i} onClick={async () => {
    const response = await fetch(file.url)
    downloadBlob(await response.blob(), file.name || '附件.txt')
  }}>📄 {file.name || '文本附件'} · 保存</button>)}</>
}
