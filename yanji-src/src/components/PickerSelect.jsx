import { Children, Fragment, isValidElement, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// 系统下拉框在安卓上会弹出一整块原生白框，跟主题对不上。
// 这个组件照着 select 的写法用（value / onChange / <option> 子节点），弹出来的是自己画的卡片。

function labelOf(node) {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(labelOf).join('')
  if (isValidElement(node)) return labelOf(node.props.children)
  return ''
}

function collectOptions(children, out = []) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    if (child.type === Fragment || child.type === 'optgroup') { collectOptions(child.props.children, out); return }
    if (child.type !== 'option') return
    const label = labelOf(child.props.children)
    out.push({
      value: String(child.props.value ?? label),
      label,
      disabled: !!child.props.disabled,
    })
  })
  return out
}

export default function PickerSelect({ value, onChange, children, className = '', style, title, disabled, ...rest }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const activeRef = useRef(null)
  const options = useMemo(() => collectOptions(children), [children])
  const current = options.find((o) => o.value === String(value ?? ''))
  const heading = title || options.find((o) => o.disabled)?.label || '请选择'
  const searchable = options.length > 10

  useEffect(() => {
    if (!open) return
    setQuery('')
    const timer = setTimeout(() => activeRef.current?.scrollIntoView({ block: 'center' }), 0)
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey) }
  }, [open])

  const pick = (opt) => {
    setOpen(false)
    if (opt.value !== String(value ?? '')) onChange?.({ target: { value: opt.value } })
  }

  const q = query.trim().toLowerCase()
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options

  return (
    <>
      <button
        type="button"
        className={(className + ' picker-trigger').trim()}
        style={style}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        {...rest}
      >
        <span className="picker-trigger-text">{current ? current.label : (options[0]?.label || '请选择')}</span>
        <svg className="picker-trigger-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && createPortal(
        <div className="picker-backdrop" onClick={() => setOpen(false)}>
          <section className="picker-sheet" role="listbox" aria-label={heading} onClick={(e) => e.stopPropagation()}>
            <div className="picker-sheet-grip" aria-hidden="true" />
            <div className="picker-sheet-title">{heading}</div>
            {searchable && (
              <input
                className="picker-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜一下…"
                enterKeyHint="search"
              />
            )}
            <div className="picker-list">
              {shown.filter((o) => !o.disabled).map((opt) => {
                const active = opt.value === String(value ?? '')
                return (
                  <button
                    type="button"
                    key={opt.value}
                    ref={active ? activeRef : null}
                    role="option"
                    aria-selected={active}
                    className={'picker-item' + (active ? ' active' : '')}
                    onClick={() => pick(opt)}
                  >
                    <span className="picker-item-text">{opt.label}</span>
                    {active && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="5 12 10 17 19 7" /></svg>}
                  </button>
                )
              })}
              {shown.length === 0 && <div className="picker-empty">没有叫这个的</div>}
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  )
}
