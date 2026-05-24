import { useState, useEffect, useCallback, useRef } from 'react'

let _show = null

export function showToast(msg, type = 'info', duration = 3000) {
  _show?.(msg, type, duration)
}

export default function Toast() {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const show = useCallback((msg, type, duration) => {
    const id = ++idRef.current
    setToasts((prev) => [...prev, { id, msg, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, duration)
  }, [])

  useEffect(() => {
    _show = show
    return () => { if (_show === show) _show = null }
  }, [show])

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
      ))}
    </div>
  )
}
