import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
// Родительный падеж для «4 июля 2026»
const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5) // шаг 5 минут

// Стилизованный выбор даты и времени. value/onChange — строка 'YYYY-MM-DDTHH:mm'.
export default function DateTimePicker({ value, onChange, id }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const openRef = useRef(open)
  openRef.current = open

  const selected = useMemo(() => parseLocal(value) || roundedNow(), [value])
  const [viewY, setViewY] = useState(selected.getFullYear())
  const [viewM, setViewM] = useState(selected.getMonth())

  useEffect(() => {
    if (open) {
      setViewY(selected.getFullYear())
      setViewM(selected.getMonth())
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    // Capture-фаза + stopPropagation: когда пикер открыт, Escape закрывает только его,
    // не долетая до модалки (которая тоже слушает Escape).
    function onKey(e) {
      if (e.key === 'Escape' && openRef.current) {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [])

  const todayMid = startOfDay(new Date())

  const cells = useMemo(() => {
    const first = new Date(viewY, viewM, 1)
    const offset = (first.getDay() + 6) % 7 // понедельник — первый
    const start = new Date(viewY, viewM, 1 - offset)
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      return d
    })
  }, [viewY, viewM])

  function emit(next) {
    onChange(formatLocal(next))
  }

  function pickDay(d) {
    if (startOfDay(d) < todayMid) return // прошлые дни недоступны
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), selected.getHours(), selected.getMinutes())
    emit(next)
    if (d.getMonth() !== viewM) {
      setViewY(d.getFullYear())
      setViewM(d.getMonth())
    }
  }

  function pickTime(h, m) {
    emit(new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), h, m))
  }

  function shiftMonth(delta) {
    const d = new Date(viewY, viewM + delta, 1)
    setViewY(d.getFullYear())
    setViewM(d.getMonth())
  }

  return (
    <div className="dtp" ref={ref}>
      <button type="button" id={id} className="dtp-trigger" onClick={() => setOpen((o) => !o)}>
        <CalendarDays size={16} />
        <span>{formatDisplay(selected)}</span>
      </button>

      {open && (
        <div className="dtp-pop">
          <div className="dtp-head">
            <button type="button" className="btn-icon" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
              <ChevronLeft size={16} />
            </button>
            <span className="dtp-title">
              {MONTHS[viewM]} {viewY}
            </span>
            <button type="button" className="btn-icon" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="dtp-grid dtp-week">
            {WEEKDAYS.map((w) => (
              <span key={w} className="dtp-wd">
                {w}
              </span>
            ))}
          </div>

          <div className="dtp-grid">
            {cells.map((d, i) => {
              const out = d.getMonth() !== viewM
              const past = startOfDay(d) < todayMid
              const sel = sameDay(d, selected)
              const today = sameDay(d, new Date())
              return (
                <button
                  type="button"
                  key={i}
                  className={
                    'dtp-day' +
                    (out ? ' out' : '') +
                    (sel ? ' sel' : '') +
                    (today && !sel ? ' today' : '')
                  }
                  disabled={past}
                  onClick={() => pickDay(d)}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>

          <div className="dtp-time">
            <Clock size={15} />
            <select value={selected.getHours()} onChange={(e) => pickTime(Number(e.target.value), selected.getMinutes())}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {pad(h)}
                </option>
              ))}
            </select>
            <span className="dtp-colon">:</span>
            <select
              value={nearestMinute(selected.getMinutes())}
              onChange={(e) => pickTime(selected.getHours(), Number(e.target.value))}
            >
              {MINUTES.map((m) => (
                <option key={m} value={m}>
                  {pad(m)}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary dtp-done" onClick={() => setOpen(false)}>
              Готово
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* helpers */
const pad = (n) => String(n).padStart(2, '0')
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

function nearestMinute(m) {
  return MINUTES.reduce((best, v) => (Math.abs(v - m) < Math.abs(best - m) ? v : best), 0)
}

function roundedNow() {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setMinutes(0, 0, 0)
  return d
}

function parseLocal(s) {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
}

function formatLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDisplay(d) {
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
