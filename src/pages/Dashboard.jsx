import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import {
  ArrowRight,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  Clock,
  Film,
  Gauge,
  Image as ImageIcon,
  MessagesSquare,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import { db } from '../lib/firebase'
import { callFunction } from '../lib/api'
import { useAccount } from '../context/AccountContext'
import { EmptyState, IgIcon, StatCard } from '../components/ui'

export default function Dashboard() {
  const { account, currentId, loading, error, createAccount, connectInstagram } = useAccount()
  const navigate = useNavigate()
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState('')

  const [posts, setPosts] = useState([])
  const [interactions, setInteractions] = useState([])
  const [health, setHealth] = useState(null)
  const [healthLoading, setHealthLoading] = useState(false)

  const connected = account?.connectionStatus === 'connected'

  // Живые подписки на данные текущего бренда.
  useEffect(() => {
    if (!currentId) return
    const unsubP = onSnapshot(
      query(collection(db, 'accounts', currentId, 'scheduled_posts'), orderBy('scheduledAt', 'desc'), limit(100)),
      (s) => setPosts(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {}
    )
    const unsubI = onSnapshot(
      query(collection(db, 'accounts', currentId, 'interactions'), orderBy('createdAt', 'desc'), limit(100)),
      (s) => setInteractions(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {}
    )
    return () => {
      unsubP()
      unsubI()
    }
  }, [currentId])

  // Здоровье аккаунта (токен, квота, доступность IG) — best-effort через функцию.
  useEffect(() => {
    if (!currentId || !connected) {
      setHealth(null)
      return
    }
    let alive = true
    setHealthLoading(true)
    callFunction('account-health', { accountId: currentId })
      .then((h) => alive && setHealth(h))
      .catch(() => alive && setHealth(null))
      .finally(() => alive && setHealthLoading(false))
    return () => {
      alive = false
    }
  }, [currentId, connected])

  const postCounts = useMemo(() => {
    const by = (s) => posts.filter((p) => p.status === s).length
    return { pending: by('pending') + by('processing'), published: by('published'), failed: by('failed') }
  }, [posts])

  const ixCounts = useMemo(() => {
    const by = (s) => interactions.filter((i) => i.status === s).length
    return { draft: by('draft'), sent: by('sent'), attention: by('needs_attention') + by('failed') }
  }, [interactions])

  const upcoming = useMemo(
    () =>
      posts
        .filter((p) => p.status === 'pending')
        .sort((a, b) => (a.scheduledAt?.toMillis?.() ?? 0) - (b.scheduledAt?.toMillis?.() ?? 0))
        .slice(0, 5),
    [posts]
  )
  const recentIx = interactions.slice(0, 5)

  const alerts = useMemo(() => buildAlerts(account, health, postCounts, ixCounts), [account, health, postCounts, ixCounts])

  async function handleConnect() {
    if (!account) return
    setConnecting(true)
    setConnectError('')
    try {
      await connectInstagram(account.id)
    } catch (err) {
      setConnectError(err.message)
      setConnecting(false)
    }
  }

  if (loading)
    return (
      <div className="screen-center" style={{ minHeight: '50vh' }}>
        <div className="spinner" />
      </div>
    )

  if (error)
    return (
      <div className="alert alert-error">
        <TriangleAlert size={16} />
        <div>
          <strong>Нет доступа к Firestore ({error.code ?? 'ошибка'})</strong>
          Опубликуйте правила безопасности: Firebase Console → Firestore Database → Правила →
          вставить содержимое файла firestore.rules → Publish.
        </div>
      </div>
    )

  if (!account) return <CreateAccountForm onCreate={createAccount} />

  const tokenDays = daysLeft(account.tokenExpiresAt)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            {greeting()}, {account.brandName}! 👋
          </h1>
          <p className="page-sub">{todayLabel()}</p>
        </div>
      </div>

      {alerts.map((a, i) => (
        <div key={i} className={`alert ${a.cls}`} style={{ marginBottom: 12 }}>
          {a.icon}
          <span>{a.text}</span>
          {a.to && (
            <Link to={a.to} className="alert-link" style={{ marginLeft: 'auto', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {a.cta} →
            </Link>
          )}
        </div>
      ))}

      <div className="quick-actions">
        <Link className="btn-soft green" to="/posts">
          <Plus size={16} />
          Запланировать пост
        </Link>
        <Link className="btn-soft purple" to="/settings">
          <SlidersHorizontal size={16} />
          Настроить бота
        </Link>
        <Link className="btn-soft blue" to="/interactions">
          <MessagesSquare size={16} />
          Лог ответов
        </Link>
      </div>

      <div className="grid-stats">
        <StatCard icon={Clock} tone="orange" value={postCounts.pending} label="Постов в очереди" sub="ждут выхода" />
        <StatCard icon={CircleCheck} tone="green" value={postCounts.published} label="Опубликовано" sub="за всё время" />
        <StatCard icon={MessagesSquare} tone="blue" value={ixCounts.sent} label="Ответов бота" sub="отправлено" />
        <StatCard icon={Clock} tone="purple" value={ixCounts.draft} label="Черновиков" sub="ждут одобрения" />
      </div>

      {/* Подключение / здоровье */}
      <section className="card connect-card">
        <span className="connect-icon">
          <IgIcon size={24} />
        </span>
        <div className="connect-body">
          {connected ? (
            <>
              <h2>@{account.instagramUsername}</h2>
              <p className="muted">
                {account.igAccountType || 'Business'}
                {health?.followersCount != null && ` · ${health.followersCount} подписчиков`}
                {health?.mediaCount != null && ` · ${health.mediaCount} публикаций`}
                {tokenDays != null && ` · токен ещё ${tokenDays} дн.`}
              </p>
            </>
          ) : (
            <>
              <h2>Подключите Instagram</h2>
              <p className="muted">
                Свяжите Business/Creator-аккаунт через OAuth Meta — после этого заработают автопостинг
                и автоответы.
              </p>
            </>
          )}
        </div>
        <div className="connect-side">
          {connected ? (
            <>
              <QuotaBadge health={health} loading={healthLoading} />
              <button className="btn" onClick={() => navigate('/accounts')}>
                Управление
              </button>
            </>
          ) : (
            <>
              <span className="badge t-orange">
                <span className="dot" />
                не подключён
              </span>
              <button className="btn btn-primary" onClick={handleConnect} disabled={connecting}>
                {connecting ? 'Открываем Instagram…' : 'Подключить Instagram'}
              </button>
              {connectError && (
                <span className="stat-sub" style={{ color: 'var(--red-deep)', maxWidth: 260, textAlign: 'right' }}>
                  {connectError}
                </span>
              )}
            </>
          )}
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <CalendarClock size={16} />
            <h3>Ближайшие посты</h3>
            <Link className="card-link" to="/posts">
              Открыть <ArrowRight size={13} />
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState small icon={CalendarClock} title="Очередь пуста" text="Запланируйте первую публикацию." />
          ) : (
            <ul className="mini-list">
              {upcoming.map((p) => (
                <li key={p.id}>
                  <span className="mini-ic">
                    {p.mediaType === 'video' ? <Film size={14} /> : <ImageIcon size={14} />}
                  </span>
                  <span className="mini-text">{p.caption || <em className="muted">Без подписи</em>}</span>
                  <span className="mini-meta mono">{shortWhen(p.scheduledAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <MessagesSquare size={16} />
            <h3>Последние ответы бота</h3>
            <Link className="card-link" to="/interactions">
              Открыть <ArrowRight size={13} />
            </Link>
          </div>
          {recentIx.length === 0 ? (
            <EmptyState small icon={MessagesSquare} title="Пока пусто" text="Здесь появятся обработанные обращения." />
          ) : (
            <ul className="mini-list">
              {recentIx.map((i) => (
                <li key={i.id}>
                  <span className="mini-ic">{i.type === 'dm' ? <MessagesSquare size={14} /> : <IgIcon size={13} />}</span>
                  <span className="mini-text">{i.botReply || i.inboundText || '—'}</span>
                  <span className={`badge ${ixTone(i.status)}`}>{ixLabel(i.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}

function QuotaBadge({ health, loading }) {
  if (loading)
    return (
      <span className="badge t-gray">
        <RefreshCw size={12} className="spin" /> проверяем…
      </span>
    )
  if (!health) return null
  if (health.igReachable === false)
    return (
      <span className="badge t-red">
        <CircleAlert size={12} /> IG недоступен
      </span>
    )
  if (health.quota)
    return (
      <span className="badge t-gray" title="Суточный лимит публикаций Meta">
        <Gauge size={12} /> публикаций сегодня: {health.quota.used}/{health.quota.total}
      </span>
    )
  return (
    <span className="badge t-green">
      <CircleCheck size={12} /> в норме
    </span>
  )
}

function buildAlerts(account, health, postCounts, ixCounts) {
  const out = []
  if (!account) return out
  if (account.connectionStatus === 'expired')
    out.push({
      cls: 'alert-error',
      icon: <TriangleAlert size={16} />,
      text: 'Токен Instagram истёк — автоматизация остановлена. Переподключите аккаунт.',
      to: '/accounts',
      cta: 'Переподключить',
    })
  else if (account.connectionStatus !== 'connected')
    out.push({
      cls: 'alert-warn',
      icon: <TriangleAlert size={16} />,
      text: 'Instagram не подключён — планировать можно, но публикация и автоответы не работают.',
      to: '/accounts',
      cta: 'Подключить',
    })
  else {
    const d = daysLeft(account.tokenExpiresAt)
    if (d != null && d <= 10)
      out.push({
        cls: 'alert-warn',
        icon: <Clock size={16} />,
        text: `Токен Instagram истекает через ${d} дн. Обновление идёт автоматически; если статус не сбросится — переподключите.`,
        to: '/accounts',
        cta: 'Аккаунты',
      })
  }
  if (postCounts.failed > 0)
    out.push({
      cls: 'alert-warn',
      icon: <CircleAlert size={16} />,
      text: `Постов с ошибкой публикации: ${postCounts.failed}. Проверьте ссылки/формат и повторите.`,
      to: '/posts',
      cta: 'Автопостинг',
    })
  if (ixCounts.attention > 0)
    out.push({
      cls: 'alert-warn',
      icon: <CircleAlert size={16} />,
      text: `Обращений требуют внимания: ${ixCounts.attention} (негатив/ошибка/пустой ответ).`,
      to: '/interactions',
      cta: 'Лог ответов',
    })
  return out
}

function CreateAccountForm({ onCreate }) {
  const [brandName, setBrandName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!brandName.trim()) return
    setBusy(true)
    setError('')
    try {
      await onCreate(brandName.trim())
    } catch (err) {
      setError(`Не удалось создать: ${err.code ?? err.message}`)
      setBusy(false)
    }
  }

  return (
    <div className="onboard">
      <form className="auth-card" onSubmit={submit}>
        <span className="logo-mark lg">
          <Zap size={22} strokeWidth={2.4} />
        </span>
        <h1>Создайте бренд-аккаунт</h1>
        <p className="muted auth-sub">
          Рабочее пространство одного клиента: к нему привяжутся Instagram-аккаунт, настройки бота
          и очередь постов.
        </p>

        <ol className="stepper">
          <li className="current">
            <span className="step-num">1</span> Бренд
          </li>
          <li>
            <span className="step-num">2</span> Instagram
          </li>
          <li>
            <span className="step-num">3</span> Автоматизация
          </li>
        </ol>

        <div className="field">
          <label className="field-label" htmlFor="brand">
            Название бренда
          </label>
          <input
            id="brand"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="Например: Кофейня «Зерно»"
            required
          />
        </div>

        {error && (
          <div className="alert alert-error">
            <TriangleAlert size={15} />
            <span>{error}</span>
          </div>
        )}

        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? 'Создаём…' : 'Создать'}
        </button>
      </form>
    </div>
  )
}

/* helpers */
function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Доброй ночи'
  if (h < 12) return 'Доброе утро'
  if (h < 18) return 'Добрый день'
  return 'Добрый вечер'
}

function todayLabel() {
  const s = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function daysLeft(ms) {
  if (!ms) return null
  const d = Math.round((ms - Date.now()) / (24 * 60 * 60 * 1000))
  return d < 0 ? 0 : d
}

function shortWhen(ts) {
  const d = ts?.toDate?.()
  if (!d) return '—'
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function ixTone(s) {
  if (s === 'sent') return 't-green'
  if (s === 'draft') return 't-orange'
  if (['needs_attention', 'failed'].includes(s)) return 't-red'
  return 't-gray'
}
function ixLabel(s) {
  return { sent: 'отправлен', draft: 'черновик', needs_attention: 'внимание', failed: 'ошибка', skipped: 'пропущен', rejected: 'отклонён' }[s] || 'в работе'
}
