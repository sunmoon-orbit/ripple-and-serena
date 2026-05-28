import { useState, useEffect } from 'react'

let listeners = []
export function showToast(msg, type = 'info') {
  listeners.forEach((l) => l({ msg, type, id: Date.now() }))
}

export function ToastHost() {
  const [t, setT] = useState(null)
  useEffect(() => {
    const fn = (toast) => {
      setT(toast)
      setTimeout(() => setT((cur) => (cur && cur.id === toast.id ? null : cur)), 2400)
    }
    listeners.push(fn)
    return () => { listeners = listeners.filter((l) => l !== fn) }
  }, [])
  if (!t) return null
  return <div className="toast">{t.msg}</div>
}
