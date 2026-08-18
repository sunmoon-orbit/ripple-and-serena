// Android WebView 注入的方法不能只靠某一个方法属性做存在性判断：部分 WebView
// 版本会把 Java bridge 暴露成特殊代理，直接读 saveBase64File 的结果并不稳定，
// 但调用 @JavascriptInterface 的 isNative() 是稳定的。两条都认，兼容旧壳。
export function hasNativeDownloadBridge() {
  try {
    const bridge = window.YanjiNative
    if (!bridge) return false
    if (bridge.isNative?.() === true) return true
    return typeof bridge.saveBase64File === 'function'
  } catch {
    return false
  }
}

// 统一的文件下载出口（2026-07-23）
// - 原生 app：DownloadManager 只认 http/https，blob: 必挂；且 <a download> 触发后立刻
//   revokeObjectURL 会让壳的异步兜底读不到内容（「没读到文件内容」）。
//   有 saveBase64File 桥就直接传 base64，文件名也能正确带上（blob URL 传不了名字）。
// - 网页：照旧 <a download>，但 revoke 延迟 60s——WebView/下载器是异步来取的。
export function downloadBlob(blob, filename) {
  if (hasNativeDownloadBridge()) {
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
