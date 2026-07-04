import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { TriangleAlert, Zap } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

const AUTH_ERRORS = {
  'auth/invalid-credential': 'Неверный email или пароль',
  'auth/user-not-found': 'Пользователь не найден',
  'auth/wrong-password': 'Неверный email или пароль',
  'auth/email-already-in-use': 'Такой email уже зарегистрирован',
  'auth/weak-password': 'Пароль слишком короткий (минимум 6 символов)',
  'auth/invalid-email': 'Некорректный email',
  'auth/too-many-requests': 'Слишком много попыток, попробуйте позже',
}

export default function Login() {
  const { user, loading, login, register } = useAuth()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (loading)
    return (
      <div className="screen-center">
        <div className="spinner" />
      </div>
    )
  if (user) return <Navigate to="/" replace />

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') await login(email, password)
      else await register(email, password)
    } catch (err) {
      setError(AUTH_ERRORS[err.code] ?? `Ошибка: ${err.code ?? err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={onSubmit}>
        <span className="logo-mark lg">
          <Zap size={22} strokeWidth={2.4} />
        </span>
        <h1>{mode === 'login' ? 'С возвращением' : 'Создать аккаунт'}</h1>
        <p className="muted auth-sub">Панель автоматизации Instagram для вашего бренда</p>

        <div className="field">
          <label className="field-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@company.com"
            required
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="password">
            Пароль
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder="Минимум 6 символов"
            minLength={6}
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
          {busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
        </button>

        <p className="switch-mode">
          {mode === 'login' ? 'Нет аккаунта? ' : 'Уже есть аккаунт? '}
          <button
            type="button"
            className="linklike"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setError('')
            }}
          >
            {mode === 'login' ? 'Зарегистрироваться' : 'Войти'}
          </button>
        </p>
      </form>
      <p className="auth-foot">InstaPilot · автопостинг и AI-ответы для Instagram</p>
    </div>
  )
}
