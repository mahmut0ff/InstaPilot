import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import {
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  MessagesSquare,
  RefreshCw,
  Send,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'
import { db } from '../lib/firebase'
import { callFunction } from '../lib/api'
import { useAccount } from '../context/AccountContext'
import { EmptyState, IgIcon, PageHeader, StatCard } from '../components/ui'

const STATUS = {
  received: { label: 'в обработке', tone: 't-blue' },
  processing: { label: 'в обработке', tone: 't-blue' },
  sending: { label: 'отправляется', tone: 't-blue' },
  draft: { label: 'черновик', tone: 't-orange' },
  sent: { label: 'отправлен', tone: 't-green' },
  skipped: { label: 'пропущен', tone: 't-gray' },
  rejected: { label: 'отклонён', tone: 't-gray' },
  needs_attention: { label: 'нужен ответ', tone: 't-red' },
  failed: { label: 'ошибка', tone: 't-red' },
}

const SENTIMENT = {
  positive: { label: 'позитив', tone: 't-green' },
  neutral: { label: 'нейтрально', tone: 't-gray' },
  negative: { label: 'негатив', tone: 't-red' },
}

const TABS = [
  { key: 'all', label: 'Все' },
  { key: 'draft', label: 'Черновики' },
  { key: 'attention', label: 'Требуют внимания' },
  { key: 'sent', label: 'Отправленные' },
]

export default function Interactions() {
  const { account, currentId, loading: accLoading } = useAccount()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('all')
  const [channel, setChannel] = useState('all') // all | comment | dm
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const connected = account?.connectionStatus === 'connected'

  useEffect(() => {
    if (!currentId) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    const q = query(
      collection(db, 'accounts', currentId, 'interactions'),
      orderBy('createdAt', 'desc'),
      limit(200)
    )
    return onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setLoading(false)
      },
      (err) => {
        setNotice({ type: 'error', text: `Ошибка загрузки: ${err.code ?? err.message}` })
        setLoading(false)
      }
    )
  }, [currentId])

  const counts = useMemo(() => {
    const by = (s) => items.filter((i) => i.status === s).length
    return {
      all: items.length,
      draft: by('draft'),
      attention: by('needs_attention') + by('failed'),
      sent: by('sent'),
    }
  }, [items])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return items.filter((i) => {
      if (channel !== 'all' && (i.type || 'comment') !== channel) return false
      if (tab === 'draft' && i.status !== 'draft') return false
      if (tab === 'sent' && i.status !== 'sent') return false
      if (tab === 'attention' && !['needs_attention', 'failed'].includes(i.status)) return false
      if (term) {
        const hay = `${i.authorUsername || ''} ${i.inboundText || ''} ${i.botReply || ''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }, [items, tab, channel, search])

  const channelCounts = useMemo(
    () => ({
      comment: items.filter((i) => (i.type || 'comment') === 'comment').length,
      dm: items.filter((i) => i.type === 'dm').length,
    }),
    [items]
  )

  async function moderate(item, action, reply) {
    setBusyId(item.id)
    setNotice(null)
    try {
      const res = await callFunction('moderate-comment', {
        accountId: currentId,
        interactionId: item.id,
        action,
        reply,
      })
      const msg =
        res.status === 'sent'
          ? 'Ответ отправлен в Instagram.'
          : res.status === 'rejected'
            ? 'Черновик отклонён.'
            : 'Ответ перегенерирован.'
      setNotice({ type: 'success', text: msg })
    } catch (err) {
      setNotice({ type: 'error', text: err.message })
    } finally {
      setBusyId(null)
    }
  }

  if (accLoading || loading)
    return (
      <div className="screen-center" style={{ minHeight: '50vh' }}>
        <div className="spinner" />
      </div>
    )

  return (
    <>
      <PageHeader
        title="Лог ответов"
        sub="Комментарии и ответы бота. В режиме «черновик» одобряйте и правьте ответы вручную."
      />

      {notice && (
        <div className={`alert ${notice.type === 'success' ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 16 }}>
          {notice.type === 'success' ? <CircleCheck size={16} /> : <TriangleAlert size={16} />}
          <span>{notice.text}</span>
          <button className="btn-icon" style={{ marginLeft: 'auto' }} onClick={() => setNotice(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {!connected && (
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
          <TriangleAlert size={16} />
          <span>
            Instagram не подключён к бренду «{account?.brandName}». Автоответы заработают после
            подключения на странице{' '}
            <Link to="/accounts" style={{ fontWeight: 600 }}>
              Аккаунты
            </Link>{' '}
            и настройки вебхуков Meta.
          </span>
        </div>
      )}

      <div className="grid-stats">
        <StatCard icon={MessagesSquare} tone="blue" value={counts.all} label="Всего" />
        <StatCard icon={Clock} tone="orange" value={counts.draft} label="Черновиков" sub="ждут одобрения" />
        <StatCard icon={CircleCheck} tone="green" value={counts.sent} label="Отправлено" />
        <StatCard icon={CircleAlert} tone="red" value={counts.attention} label="Требуют внимания" />
      </div>

      <div className="pill-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`pill${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            <span className="pill-count">{counts[t.key] ?? 0}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div className="seg">
          <button className={`seg-btn${channel === 'all' ? ' active' : ''}`} onClick={() => setChannel('all')}>
            Все каналы
          </button>
          <button className={`seg-btn${channel === 'comment' ? ' active' : ''}`} onClick={() => setChannel('comment')}>
            <IgIcon size={13} /> Комментарии
          </button>
          <button className={`seg-btn${channel === 'dm' ? ' active' : ''}`} onClick={() => setChannel('dm')}>
            <Send size={13} /> Директ
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <Sparkles size={15} />
          <input placeholder="Поиск по автору, тексту, ответу…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <span className="toolbar-count">
          {filtered.length}
          {filtered.length !== items.length ? ` из ${items.length}` : ''}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={MessagesSquare}
            title="Пока нет обработанных обращений"
            text="Комментарии под постами и сообщения в директ будут приходить сюда через вебхук Meta, а бот сгенерирует ответ по вашим настройкам. В режиме «черновик» ответы ждут вашего одобрения. Директ включается тумблером в настройках после Meta App Review."
            chip="нужны подключение и вебхуки Meta"
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState small icon={Sparkles} title="Ничего не найдено" text="Измените фильтр или поиск." />
        </div>
      ) : (
        <div className="interactions">
          {filtered.map((item) => (
            <InteractionCard
              key={item.id}
              item={item}
              connected={connected}
              busy={busyId === item.id}
              onModerate={moderate}
            />
          ))}
        </div>
      )}
    </>
  )
}

function InteractionCard({ item, connected, busy, onModerate }) {
  const [reply, setReply] = useState(item.botReply || '')
  const [manual, setManual] = useState(false)

  // Подтягиваем изменившийся черновик (после перегенерации) в поле.
  useEffect(() => {
    setReply(item.botReply || '')
  }, [item.botReply])

  const st = STATUS[item.status] || STATUS.received
  const sent = item.status === 'sent'
  const inProgress = ['received', 'processing', 'sending'].includes(item.status)
  const showEditor = !sent && !inProgress && (item.status !== 'skipped' || manual)

  return (
    <div className="card interaction">
      <div className="ix-head">
        <span className="ix-avatar">
          {item.type === 'dm' ? <Send size={13} /> : <IgIcon size={14} />}
        </span>
        <span className="ix-author">
          {item.authorUsername ? `@${item.authorUsername}` : item.type === 'dm' ? 'Собеседник' : 'Пользователь'}
        </span>
        <span className="chip chip-purple">{item.type === 'dm' ? 'директ' : 'комментарий'}</span>
        <span className={`badge ${st.tone}`}>{st.label}</span>
        {item.sentiment && SENTIMENT[item.sentiment] && (
          <span className={`chip ${SENTIMENT[item.sentiment].tone === 't-green' ? 'chip-green' : 'chip-purple'}`}>
            {SENTIMENT[item.sentiment].label}
          </span>
        )}
        <span className="spacer" />
        <span className="ix-time">{timeAgo(item.createdAt)}</span>
      </div>

      <div className="ix-comment">
        <span className="ix-quote-bar" />
        <p>{item.inboundText}</p>
      </div>

      {item.aiReason && ['skipped', 'needs_attention'].includes(item.status) && (
        <p className="ix-reason">
          <Sparkles size={12} /> {item.aiReason}
        </p>
      )}

      {inProgress && <p className="ix-reason">Бот генерирует ответ…</p>}

      {item.status === 'failed' && item.error && (
        <p className="ix-reason" style={{ color: 'var(--red-deep)' }}>
          <CircleAlert size={12} /> {item.error}
        </p>
      )}

      {sent && (
        <div className="ix-sent">
          <Check size={14} />
          <p>{item.sentReply || item.botReply}</p>
        </div>
      )}

      {item.status === 'skipped' && !manual && (
        <button className="linklike ix-manual-btn" onClick={() => setManual(true)}>
          Ответить вручную
        </button>
      )}

      {showEditor && (
        <div className="ix-editor">
          <textarea
            rows={2}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Ответ бренда…"
          />
          <div className="ix-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || !connected || !reply.trim()}
              onClick={() => onModerate(item, 'approve', reply)}
              title={!connected ? 'Сначала подключите Instagram' : undefined}
            >
              <Send size={14} /> {busy ? 'Отправляем…' : 'Одобрить и отправить'}
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={() => onModerate(item, 'regenerate')}>
              <RefreshCw size={14} /> Перегенерировать
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={() => onModerate(item, 'reject')}>
              <X size={14} /> Отклонить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function timeAgo(ts) {
  const d = ts?.toDate?.()
  if (!d) return ''
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60) return 'только что'
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
