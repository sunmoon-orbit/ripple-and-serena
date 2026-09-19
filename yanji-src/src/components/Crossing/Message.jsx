import MessageBubble from '../Chat/MessageBubble'
import { canReadMessage } from './messages.mjs'

export default function CrossingMessage({ message, config, stopEpoch }) {
  return <MessageBubble
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
  />
}
