const INTERACTIVE_BUBBLE_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  'iframe',
  'audio',
  'video',
  '[role="button"]',
  '[contenteditable="true"]',
  '.bubble-attach-header',
  '.voice-bar',
  '.user-voice-text',
].join(',')

// 气泡里有链接、代码按钮、语音条等自己的交互；操作它们时不能顺手把消息信息行藏掉。
// 划选文字后松手也会触发 click，所以把仍存在的文字选区一起排除。
export function shouldToggleMessageMeta(target, hasTextSelection = false) {
  if (hasTextSelection) return false
  if (!target || typeof target.closest !== 'function') return false
  return !target.closest(INTERACTIVE_BUBBLE_SELECTOR)
}
