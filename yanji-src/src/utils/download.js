// 统一的文件下载出口（2026-07-23）
// - 原生 app：DownloadManager 只认 http/https，blob: 必挂；且 <a download> 触发后立刻
//   revokeObjectURL 会让壳的异步兜底读不到内容（「没读到文件内容」）。
//   有 saveBase64File 桥就直接传 base64，文件名也能正确带上（blob URL 传不了名字）。
// - 网页：照旧 <a download>，但 revoke 延迟 60s——WebView/下载器是异步来取的。
export function downloadBlob(blob, filename) {
  if (window.YanjiNative?.saveBase64File) {
    const fr = new FileReader()
    fr.onload = () => {
      const b64 = String(fr.result).split(',')[1] || ''
      window.YanjiNative.saveBase64File(filename, blob.type || '', b64)
    }
    fr.readAsDataURL(blob)
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
