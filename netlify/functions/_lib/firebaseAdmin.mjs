// Firebase Admin SDK — единый инстанс на «тёплый» контейнер функции.
// Admin SDK обходит security rules, поэтому только здесь мы пишем в accounts/*/private/*.
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { HttpError, requireEnv } from './http.mjs'

function serviceAccount() {
  const raw = requireEnv('FIREBASE_SERVICE_ACCOUNT')
  let parsed
  try {
    // Принимаем и base64(JSON), и «сырой» JSON — что удобнее вставить в Netlify.
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
    parsed = JSON.parse(text)
  } catch {
    throw new HttpError(500, 'FIREBASE_SERVICE_ACCOUNT: не удалось разобрать (ожидается base64 от JSON сервис-аккаунта)', 'ENV_BAD')
  }
  // Приватный ключ в env часто хранится с экранированными переносами строк.
  if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
  return parsed
}

// Ленивая инициализация: не трогаем сервис-аккаунт на этапе import, иначе пустой
// FIREBASE_SERVICE_ACCOUNT ронял бы всю функцию при загрузке (netlify dev -> 500 HTML).
// Так ошибка конфигурации возникает при первом обращении — внутри try/catch функции —
// и возвращается аккуратным JSON.
let _app
function ensureApp() {
  if (!_app) _app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(serviceAccount()) })
  return _app
}

// Прокси откладывает getAuth/getFirestore до первого обращения к свойству,
// сохраняя привычный синтаксис adminAuth.verifyIdToken / adminDb.collection.
function lazy(factory) {
  let inst
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (!inst) inst = factory()
        const v = inst[prop]
        return typeof v === 'function' ? v.bind(inst) : v
      },
    }
  )
}

export const adminAuth = lazy(() => getAuth(ensureApp()))
export const adminDb = lazy(() => getFirestore(ensureApp()))
