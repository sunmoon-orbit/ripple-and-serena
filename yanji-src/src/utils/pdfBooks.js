// 原样 PDF 的文件只放在这台设备的 IndexedDB 里（1023）：图文教程动辄几十 MB，没必要传服务器；
// 她换设备时阅读页会让她重新选一次同一个文件。
const DB = 'yanji-pdf-books', STORE = 'files'

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function savePdfBlob(bookId, blob) {
  const d = await db()
  await new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, String(bookId))
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
  })
  d.close()
}

export async function loadPdfBlob(bookId) {
  const d = await db()
  const blob = await new Promise((resolve, reject) => {
    const req = d.transaction(STORE).objectStore(STORE).get(String(bookId))
    req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error)
  })
  d.close()
  return blob
}

export async function deletePdfBlob(bookId) {
  const d = await db()
  await new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(String(bookId))
    tx.oncomplete = resolve; tx.onerror = resolve
  })
  d.close()
}

export async function openPdf(blob) {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
}
