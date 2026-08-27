import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Check,
  CircleCheck,
  Clock,
  Link as LinkIcon,
  Plus,
  TriangleAlert,
  Unlink,
  Users,
  X,
} from 'lucide-react'
import { useAccount } from '../context/AccountContext'
import { EmptyState, IgIcon, PageHeader, StatCard } from '../components/ui'

export default function Accounts() {
  const {
    accounts,
    currentId,
    setCurrentId,
    loading,
    error,
    singleAccountMode,
    canCreateAccount,
    createAccount,
    connectInstagram,
    disconnectInstagram,
  } = useAccount()

  const [params, setParams] = useSearchParams()
  const [notice, setNotice] = useState(null)
  const [adding, setAdding] = useState(false)
  const [brandName, setBrandName] = useState('')
  const [busyId, setBusyId] = useState(null) // id аккаунта, по которому идёт запрос
  const [formError, setFormError] = useState('')

  // Разбор результата OAuth-возврата (redirect из instagram-callback -> /accounts?...).
  useEffect(() => {
    if (params.get('connected')) {
      const uname = params.get('username')
      setNotice({
        type: params.get('ig_warn') === 'account_type_personal' ? 'warn' : 'success',
        text:
          params.get('ig_warn') === 'account_type_personal'
            ? `Аккаунт @${uname} подключён, но это личный профиль. Для автопостинга и ответов переключите его в Business/Creator в приложении Instagram.`
            : `Instagram @${uname} успешно подключён.`,
      })
    } else if (params.get('ig_error')) {
      setNotice({ type: 'error', text: `Не удалось подключить Instagram: ${params.get('ig_error')}` })
    }
    if (params.get('connected') || params.get('ig_error')) {
      const next = new URLSearchParams(params)
      ;['connected', 'username', 'ig_error', 'ig_warn', 'account'].forEach((k) => next.delete(k))
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stats = useMemo(() => {
    const connected = accounts.filter((a) => a.connectionStatus === 'connected').length
    const attention = accounts.filter((a) =>
      ['disconnected', 'expired', 'error'].includes(a.connectionStatus)
    ).length
    return { total: accounts.length, connected, attention }
  }, [accounts])

  async function handleConnect(id) {
    setBusyId(id)
    setNotice(null)
    try {
      await connectInstagram(id) // редиректит на Instagram
    } catch (err) {
      setNotice({ type: 'error', text: err.message })
      setBusyId(null)
    }
  }

  async function handleDisconnect(id, name) {
    if (!window.confirm(`Отвязать Instagram от «${name}»? Автоматизация остановится, токен будет удалён.`))
      return
    setBusyId(id)
    setNotice(null)
    try {
      await disconnectInstagram(id)
      setNotice({ type: 'success', text: 'Instagram отвязан.' })
    } catch (err) {
      setNotice({ type: 'error', text: err.message })
    } finally {
      setBusyId(null)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!brandName.trim()) return
    setFormError('')
    try {
      await createAccount(brandName.trim())
      setBrandName('')
      setAdding(false)
    } catch (err) {
      setFormError(err.code ?? err.message)
    }
  }

  if (loading)
    return (
      <div className="screen-center" style={{ minHeight: '50vh' }}>
        <div className="spinner" />
      </div>
    )

  return (
    <>
      <PageHeader
        title={singleAccountMode ? 'Instagram-аккаунт' : 'Аккаунты'}
        sub={
          singleAccountMode
            ? 'Один Business/Creator-профиль: от его имени идут автопостинг и автоответы на комментарии'
            : 'Подключайте несколько Instagram Business/Creator-профилей и управляйте каждым отдельно'
        }
        actions={
          canCreateAccount && (
            <button className="btn btn-primary" onClick={() => setAdding((v) => !v)}>
              <Plus size={16} />
              {singleAccountMode ? 'Создать бренд' : 'Добавить бренд'}
            </button>
          )
        }
      />

      {notice && (
        <div className={`alert ${noticeClass(notice.type)}`} style={{ marginBottom: 16 }}>
          {notice.type === 'success' ? <CircleCheck size={16} /> : <TriangleAlert size={16} />}
          <span>{notice.text}</span>
          <button className="btn-icon" style={{ marginLeft: 'auto' }} onClick={() => setNotice(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <TriangleAlert size={16} />
          <span>Ошибка доступа к данным: {error.code ?? error.message}</span>
        </div>
      )}

      {/* Сводка по нескольким брендам нужна только в multi-режиме — при одном аккаунте
          всё то же самое видно на его карточке ниже. */}
      {!singleAccountMode && (
        <div className="grid-stats">
          <StatCard icon={Users} tone="blue" value={stats.total} label="Всего брендов" />
          <StatCard icon={CircleCheck} tone="green" value={stats.connected} label="Подключено" />
          <StatCard icon={TriangleAlert} tone="orange" value={stats.attention} label="Требуют действия" />
        </div>
      )}

      {adding && (
        <form className="card" style={{ marginBottom: 16 }} onSubmit={handleCreate}>
          <div className="card-head">
            <Plus size={16} />
            <h3>Новый бренд-аккаунт</h3>
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label className="field-label" htmlFor="newbrand">
              Название бренда
            </label>
            <input
              id="newbrand"
              autoFocus
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="Например: Пекарня «Тесто»"
            />
            {formError && <p className="field-hint" style={{ color: 'var(--red-deep)' }}>{formError}</p>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="submit">
              Создать
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setAdding(false)
                setBrandName('')
                setFormError('')
              }}
            >
              Отмена
            </button>
          </div>
        </form>
      )}

      {accounts.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Users}
            title="Бренд ещё не создан"
            text="Создайте бренд-аккаунт и подключите к нему Instagram."
          />
        </div>
      ) : (
        <div className="account-list">
          {accounts.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              single={singleAccountMode}
              isCurrent={a.id === currentId}
              busy={busyId === a.id}
              onSelect={() => setCurrentId(a.id)}
              onConnect={() => handleConnect(a.id)}
              onDisconnect={() => handleDisconnect(a.id, a.brandName)}
            />
          ))}
        </div>
      )}
    </>
  )
}

function AccountCard({ account, single, isCurrent, busy, onSelect, onConnect, onDisconnect }) {
  const status = statusMeta(account.connectionStatus)
  const connected = account.connectionStatus === 'connected'
  const days = daysLeft(account.tokenExpiresAt)

  return (
    <div className={`card account-card${isCurrent ? ' is-current' : ''}`}>
      <span className="connect-icon" style={{ width: 46, height: 46, borderRadius: 12 }}>
        <IgIcon size={22} />
      </span>

      <div className="account-main">
        <div className="account-title-row">
          <h3>{account.brandName}</h3>
          {isCurrent && !single && <span className="chip chip-green">активный</span>}
        </div>
        <div className="account-meta">
          <span className={`badge ${status.tone}`}>
            <span className="dot" />
            {status.label}
          </span>
          {connected && account.instagramUsername && (
            <span className="account-username">@{account.instagramUsername}</span>
          )}
          {connected && account.igAccountType && (
            <span className="chip chip-purple">{account.igAccountType}</span>
          )}
          {connected && days != null && (
            <span className="account-expiry">
              <Clock size={12} /> токен ещё {days} дн.
            </span>
          )}
        </div>
        {account.lastConnectionError && !connected && (
          <p className="account-error">{account.lastConnectionError}</p>
        )}
      </div>

      <div className="account-actions">
        {!isCurrent && (
          <button className="btn btn-ghost" onClick={onSelect} title="Сделать активным">
            <Check size={15} /> Выбрать
          </button>
        )}
        {connected ? (
          <button className="btn" onClick={onDisconnect} disabled={busy}>
            <Unlink size={15} /> {busy ? 'Отвязываем…' : 'Отвязать'}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={onConnect} disabled={busy}>
            <LinkIcon size={15} /> {busy ? 'Открываем Instagram…' : 'Подключить Instagram'}
          </button>
        )}
      </div>
    </div>
  )
}

function noticeClass(type) {
  if (type === 'success') return 'alert-success'
  if (type === 'warn') return 'alert-warn'
  return 'alert-error'
}

function statusMeta(status) {
  switch (status) {
    case 'connected':
      return { label: 'подключён', tone: 't-green' }
    case 'expired':
      return { label: 'токен истёк', tone: 't-orange' }
    case 'error':
      return { label: 'ошибка', tone: 't-red' }
    default:
      return { label: 'не подключён', tone: 't-gray' }
  }
}

function daysLeft(tokenExpiresAt) {
  if (!tokenExpiresAt) return null
  const ms = tokenExpiresAt - Date.now()
  if (ms <= 0) return 0
  return Math.round(ms / (24 * 60 * 60 * 1000))
}
