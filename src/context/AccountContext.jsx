import { createContext, useContext, useEffect, useState } from 'react'
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { callFunction } from '../lib/api'
import { useAuth } from './AuthContext'
import { SINGLE_ACCOUNT_MODE } from '../../shared/config.mjs'

// Текущий «бренд-аккаунт» (tenant). Вся панель всегда работает в контексте
// выбранного (scoping по currentId) — это не меняется от режима.
// При SINGLE_ACCOUNT_MODE аккаунт ровно один: список всё равно грузим запросом
// по ownerUid (та же изоляция), просто создать второй нельзя, а переключаться не из чего.
const AccountContext = createContext(null)

export function AccountProvider({ children }) {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!user) {
      setAccounts([])
      setCurrentId(null)
      setLoading(false)
      return
    }
    setLoading(true)
    // Все данные строго отфильтрованы по владельцу — основа multi-tenant изоляции на клиенте.
    const q = query(collection(db, 'accounts'), where('ownerUid', '==', user.uid))
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.brandName || '').localeCompare(b.brandName || '', 'ru'))
        setAccounts(list)
        setCurrentId((prev) => (list.some((a) => a.id === prev) ? prev : list[0]?.id ?? null))
        setError(null)
        setLoading(false)
      },
      (err) => {
        console.error('accounts subscription failed', err)
        setError(err)
        setLoading(false)
      }
    )
  }, [user])

  // В режиме одного аккаунта создать бренд можно только пока его нет.
  const canCreateAccount = !SINGLE_ACCOUNT_MODE || accounts.length === 0

  // Создать новый бренд-аккаунт.
  async function createAccount(brandName) {
    if (!canCreateAccount) {
      throw new Error('Сейчас проект работает с одним аккаунтом — второй бренд создать нельзя')
    }
    const ref = await addDoc(collection(db, 'accounts'), {
      ownerUid: user.uid,
      brandName,
      instagramBusinessId: null,
      instagramUsername: null,
      connectionStatus: 'disconnected',
      createdAt: serverTimestamp(),
    })
    await setDoc(doc(db, 'accounts', ref.id, 'settings', 'bot'), {
      toneOfVoice: '',
      brandContext: '',
      forbiddenTopics: [],
      language: 'auto',
      useEmojis: true,
      signature: '',
      autoReplyComments: false,
      autoReplyDms: false,
      draftMode: true,
      escalateNegative: true,
      updatedAt: serverTimestamp(),
    })
    setCurrentId(ref.id)
    return ref.id
  }

  // Переименовать бренд. Имя видно в панели и подставляется в системный промпт Gemini
  // («Ты — SMM-ассистент бренда ...»), поэтому менять его — не косметика.
  // Поля подключения Instagram правилами Firestore клиенту закрыты, brandName — разрешён.
  async function renameAccount(accountId, brandName) {
    const name = brandName.trim()
    if (!name) throw new Error('Название бренда не может быть пустым')
    await updateDoc(doc(db, 'accounts', accountId), { brandName: name })
  }

  // Запускает OAuth Instagram для конкретного аккаунта — редиректит на Instagram.
  async function connectInstagram(accountId) {
    const { authUrl } = await callFunction('connect-instagram', { accountId })
    if (!authUrl) throw new Error('Сервер не вернул ссылку авторизации')
    window.location.href = authUrl
  }

  // Отвязывает Instagram (удаляет токен на бэкенде).
  async function disconnectInstagram(accountId) {
    await callFunction('connect-instagram', { accountId, action: 'disconnect' })
  }

  const account = accounts.find((a) => a.id === currentId) ?? null

  return (
    <AccountContext.Provider
      value={{
        accounts,
        account,
        currentId,
        setCurrentId,
        singleAccountMode: SINGLE_ACCOUNT_MODE,
        canCreateAccount,
        createAccount,
        renameAccount,
        connectInstagram,
        disconnectInstagram,
        loading,
        error,
      }}
    >
      {children}
    </AccountContext.Provider>
  )
}

export const useAccount = () => useContext(AccountContext)
