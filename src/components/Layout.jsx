import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  AtSign,
  CalendarClock,
  Check,
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  Plus,
  Settings,
  SlidersHorizontal,
  Zap,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'

const NAV = [
  {
    section: 'Обзор',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Дашборд', end: true },
      { to: '/accounts', icon: AtSign, label: 'Аккаунты' },
    ],
  },
  {
    section: 'Контент',
    items: [{ to: '/posts', icon: CalendarClock, label: 'Автопостинг' }],
  },
  {
    section: 'Общение',
    items: [
      { to: '/settings', icon: SlidersHorizontal, label: 'Настройки бота' },
      { to: '/interactions', icon: MessagesSquare, label: 'Лог ответов' },
    ],
  },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const { account } = useAccount()
  const navigate = useNavigate()
  const connected = account?.connectionStatus === 'connected'

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sb-logo">
          <span className="logo-mark">
            <Zap size={17} strokeWidth={2.4} />
          </span>
          <span className="sb-logo-name">InstaPilot</span>
        </div>

        <AccountSwitcher />

        <nav className="sb-nav">
          {NAV.map((group) => (
            <div className="sb-group" key={group.section}>
              <div className="sb-section">{group.section}</div>
              {group.items.map(({ to, icon: Icon, label, chip, end }) => (
                <NavLink key={to} to={to} end={end}>
                  <Icon size={17} strokeWidth={1.9} />
                  <span className="sb-label">{label}</span>
                  {chip && <span className="chip chip-purple">{chip}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sb-footer">
          <span className="avatar">{initials(user.email)}</span>
          <div className="sb-user">
            <div className="sb-user-name">{user.email.split('@')[0]}</div>
            <div className="sb-user-role">Владелец</div>
          </div>
          <button className="btn-icon" title="Настройки бота" onClick={() => navigate('/settings')}>
            <Settings size={15} />
          </button>
          <button className="btn-icon" title="Выйти" onClick={logout}>
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="spacer" />
          <span className={`badge ${connected ? 't-green' : 't-orange'}`}>
            <span className="dot" />
            {connected ? `Instagram: @${account.instagramUsername}` : 'Instagram не подключён'}
          </span>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function AccountSwitcher() {
  const { accounts, account, setCurrentId } = useAccount()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  if (!account) return null

  const dotClass = (a) => (a.connectionStatus === 'connected' ? 'dot dot-green' : 'dot dot-orange')

  return (
    <div className="sb-account" ref={ref}>
      <button className="sb-account-btn" onClick={() => setOpen((o) => !o)}>
        <span className={dotClass(account)} />
        <span className="sb-account-name">{account.brandName}</span>
        <ChevronsUpDown size={14} />
      </button>
      {open && (
        <div className="menu">
          {accounts.map((a) => (
            <button
              key={a.id}
              className="menu-item"
              onClick={() => {
                setCurrentId(a.id)
                setOpen(false)
              }}
            >
              <span className={dotClass(a)} />
              <span className="sb-label">{a.brandName}</span>
              {a.id === account.id && <Check size={14} className="menu-check" />}
            </button>
          ))}
          <div className="menu-sep" />
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false)
              navigate('/accounts')
            }}
          >
            <Plus size={14} />
            <span className="sb-label">Добавить / управлять</span>
          </button>
        </div>
      )}
    </div>
  )
}

function initials(email = '') {
  const name = email.split('@')[0]
  return name.slice(0, 2).toUpperCase() || '?'
}
