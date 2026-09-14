export function compressImage(file, maxDim = 1280, quality = 0.8) {
    return new Promise((resolve) => {
      const fallback = () => {
        const reader = new FileReader()
        reader.onload = (ev) => resolve(ev.target.result)
        reader.readAsDataURL(file)
      }
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
          const w = Math.round(img.width * scale)
          const h = Math.round(img.height * scale)
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          canvas.getContext('2d').drawImage(img, 0, 0, w, h)
          resolve(canvas.toDataURL('image/jpeg', quality))
        } catch { fallback() }
      }
      img.onerror = () => { URL.revokeObjectURL(url); fallback() }
      img.src = url
    })
  }

export async function prepareAttachment(file, strict = false) {
  if (file.type.startsWith('image/')) {
    if (strict && !['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) throw new Error('仅支持 JPEG、PNG、WebP、GIF 图片')
    if (strict && file.size > 4 * 1024 * 1024) throw new Error('图片最大 4MB')
    const dataUrl = await compressImage(file)
    const mime = dataUrl.slice(5, dataUrl.indexOf(';'))
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[mime]
    if (strict && !extension) throw new Error('图片格式不支持')
    return { kind: 'image', name: extension ? file.name.replace(/\.[^.]*$/, '') + '.' + extension : file.name, mime, data: dataUrl.split(',')[1], dataUrl }
  }
  if (!/\.(txt|md|csv|json|js|py|html|css)$/i.test(file.name) && (strict || file.type !== 'text/plain')) throw new Error('仅支持 UTF-8 文本；PDF、Office、压缩包暂不支持')
  if (file.size > 200 * 1024) throw new Error('文本文件最大 200KB')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const content = new TextDecoder('utf-8', { fatal: strict }).decode(bytes)
  if (strict && bytes.includes(0)) throw new Error('不支持二进制文件')
  let binary = ''; for (const b of bytes) binary += String.fromCharCode(b)
  return { kind: 'text', name: file.name, mime: file.type || 'text/plain', data: btoa(binary), content }
}
