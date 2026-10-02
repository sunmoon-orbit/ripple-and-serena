export const INITIAL_MESSAGE_RENDER = 80
export const MESSAGE_RENDER_BATCH = 80

export function buildMessageRenderWindow(messages, renderCount = INITIAL_MESSAGE_RENDER) {
  const visible = Array.isArray(messages) ? messages.filter((message) => !message?.hidden) : []
  const count = Math.max(1, Number(renderCount) || INITIAL_MESSAGE_RENDER)
  const start = Math.max(0, visible.length - count)
  return {
    visible,
    rendered: visible.slice(start),
    remaining: start,
  }
}

export function renderCountForMessage(messages, messageId, currentCount = INITIAL_MESSAGE_RENDER) {
  const { visible } = buildMessageRenderWindow(messages, currentCount)
  const index = visible.findIndex((message) => String(message?.id) === String(messageId))
  if (index < 0) return currentCount
  return Math.max(currentCount, visible.length - index)
}
