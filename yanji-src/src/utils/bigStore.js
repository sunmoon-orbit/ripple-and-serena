// 大盒子：聊天记录专用的 IndexedDB 仓库。
//
// 为什么要有这个文件（2026-08-02）：
// 原本所有状态——设置、主题、头像、聊天记录——都塞在同一个 localStorage key 里。
// localStorage 的配额只有约 5MB，而 messagesByChatId 是无上限增长的。阿颖在同一个
// 窗口聊了几个月之后配额撑满，`setItem` 开始抛 QuotaExceededError，而当时的
// `savePersistedState` 是 `catch {}` ——静默吞掉。结果是：
//   · 新消息存不进去，刷新就没了
//   · 换了头像也存不进去，刷新变回旧的
// 一个盒子满了，所有东西一起坏，而且不报错。
//
// IndexedDB 的配额是按可用磁盘算的（通常几百 MB 到几 GB），够聊很久。

const DB_NAME = 'yanji_big'
const DB_VERSION = 1
const STORE = 'kv'

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB 不可用'))
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('打不开 IndexedDB'))
    request.onblocked = () => reject(new Error('IndexedDB 被其它标签页占住'))
  })
  return dbPromise
}

export async function bigGet(key) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function bigSet(key, value) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('IndexedDB 写入被中止'))
  })
}

// 用量估算，给设置页显示"聊天记录占了多少"。拿不到就返回 null，不要报错。
export async function bigUsage() {
  try {
    if (!navigator.storage?.estimate) return null
    const { usage, quota } = await navigator.storage.estimate()
    if (typeof usage !== 'number' || typeof quota !== 'number' || !quota) return null
    return { usage, quota, ratio: usage / quota }
  } catch {
    return null
  }
}
