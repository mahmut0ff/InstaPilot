// Мелкие переиспользуемые presentational-компоненты дизайн-системы.
import { useEffect } from 'react'
import { X } from 'lucide-react'

export function PageHeader({ title, sub, chip, actions }) {
  return (
    <div className="page-head">
      <div>
        <h1>
          {title}
          {chip && <span className="chip chip-purple">{chip}</span>}
        </h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function StatCard({ icon: Icon, tone = 'gray', value, label, sub }) {
  return (
    <div className="stat-card">
      <span className={`iconbox t-${tone}`}>
        <Icon size={19} strokeWidth={2} />
      </span>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
      <Icon className="stat-watermark" aria-hidden />
    </div>
  )
}

export function EmptyState({ icon: Icon, title, text, chip, small }) {
  return (
    <div className={small ? 'empty small' : 'empty'}>
      <span className="empty-icon">
        <Icon size={21} strokeWidth={1.8} />
      </span>
      <h4>{title}</h4>
      <p>{text}</p>
      {chip && <span className="chip chip-purple">{chip}</span>}
    </div>
  )
}

export function Switch({ checked, disabled, onChange, label }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      <span className="knob" />
    </label>
  )
}

// Модальное окно. Закрывается по клику на фон и по Esc.
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

// Брендовый глиф Instagram (локальный SVG — в lucide брендовые иконки упраздняются)
export function IgIcon({ size = 18, strokeWidth = 2, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  )
}
