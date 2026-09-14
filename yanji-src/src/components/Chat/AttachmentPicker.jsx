import { forwardRef } from 'react'
import { prepareAttachment } from '../../utils/attachments'

export const AttachmentPicker = forwardRef(function AttachmentPicker({ onAttachment, onError, imagesAllowed = true, onBusy, strict = false }, ref) {
  return <input ref={ref} type="file" multiple accept={(imagesAllowed ? (strict ? 'image/jpeg,image/png,image/webp,image/gif,' : 'image/*,') : '') + '.txt,.md,.csv,.json,.js,.py,.html,.css'} style={{ display: 'none' }} onChange={async e => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    onBusy?.(true)
    try { for (const file of files) {
      if (file.type.startsWith('image/') && !imagesAllowed) throw new Error('当前模型不支持图片')
      await onAttachment(await prepareAttachment(file, strict))
    } } catch (error) { onError?.(error.message || '读取附件失败') }
    finally { onBusy?.(false) }
  }} />
})
