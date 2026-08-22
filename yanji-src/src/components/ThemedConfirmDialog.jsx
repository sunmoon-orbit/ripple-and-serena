import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const ConfirmContext = createContext(null)

export function ThemedConfirmDialog({
  kicker = '请确认',
  title,
  description,
  note,
  cancelLabel = '取消',
  confirmLabel = '确定',
  onCancel,
  onConfirm,
}) {
  const cancelButtonRef = useRef(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const previousFocus = document.activeElement
    cancelButtonRef.current?.focus()
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus?.()
    }
  }, [onCancel])

  return createPortal(
    <div className="retry-dialog-backdrop">
      <section
        className="retry-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <svg className="retry-dialog-sky" viewBox="0 0 360 108" aria-hidden="true">
          <path className="retry-dialog-orbit orbit-back" d="M18 82C86 22 229 6 342 65" />
          <path className="retry-dialog-orbit" d="M-8 98C87 37 221 28 371 76" />
          <circle className="retry-dialog-dot dot-one" cx="292" cy="31" r="2.2" />
          <circle className="retry-dialog-dot dot-two" cx="316" cy="54" r="1.5" />
          <path className="retry-dialog-star" d="M257 21l1.8 4.6 4.7 1.8-4.7 1.8-1.8 4.6-1.8-4.6-4.7-1.8 4.7-1.8z" />
          <path className="retry-dialog-moon" d="M75 31a18 18 0 1 0 20 25A19.5 19.5 0 1 1 75 31Z" />
        </svg>

        <div className="retry-dialog-kicker">{kicker}</div>
        <h2 id={titleId}>{title}</h2>
        {description && <p id={descriptionId}>{description}</p>}

        {note && (
          <div className="retry-dialog-note">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 10.5v5" />
              <circle cx="12" cy="7.6" r=".7" fill="currentColor" stroke="none" />
            </svg>
            <span>{note}</span>
          </div>
        )}

        <div className="retry-dialog-actions">
          <button ref={cancelButtonRef} className="retry-dialog-cancel" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="retry-dialog-confirm" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  )
}

export function ThemedConfirmProvider({ children }) {
  const [request, setRequest] = useState(null)
  const resolverRef = useRef(null)

  const confirm = useCallback((options) => new Promise((resolve) => {
    resolverRef.current?.(false)
    resolverRef.current = resolve
    setRequest(options)
  }), [])

  const settle = useCallback((accepted) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setRequest(null)
    resolve?.(accepted)
  }, [])

  useEffect(() => () => {
    resolverRef.current?.(false)
    resolverRef.current = null
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <ThemedConfirmDialog
          {...request}
          onCancel={() => settle(false)}
          onConfirm={() => settle(true)}
        />
      )}
    </ConfirmContext.Provider>
  )
}

export function useThemedConfirm() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useThemedConfirm must be used inside ThemedConfirmProvider')
  return confirm
}
