// Проверка личности вызывающего (Firebase ID token) и принадлежности аккаунта (tenant).
import { adminAuth, adminDb } from './firebaseAdmin.mjs'
import { HttpError } from './http.mjs'

// Достаёт и проверяет Firebase ID token из заголовка Authorization: Bearer <token>.
export async function requireUser(req) {
  const header = req.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new HttpError(401, 'Требуется авторизация', 'NO_AUTH')
  try {
    const decoded = await adminAuth.verifyIdToken(match[1])
    return { uid: decoded.uid, email: decoded.email ?? null }
  } catch (err) {
    // Ошибки конфигурации (например, не задан FIREBASE_SERVICE_ACCOUNT) — не маскируем
    // под «неверный токен», а показываем как есть.
    if (err instanceof HttpError) throw err
    throw new HttpError(401, 'Недействительный или истёкший токен авторизации', 'BAD_AUTH')
  }
}

// Загружает документ аккаунта и проверяет, что uid — его владелец.
// Возвращает { ref, data }. Это ядро multi-tenant изоляции: без совпадения ownerUid — 403.
export async function requireOwnedAccount(uid, accountId) {
  if (!accountId || typeof accountId !== 'string') {
    throw new HttpError(400, 'Не указан accountId', 'NO_ACCOUNT')
  }
  const ref = adminDb.collection('accounts').doc(accountId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'Аккаунт не найден', 'ACCOUNT_NOT_FOUND')
  const data = snap.data()
  if (data.ownerUid !== uid) {
    throw new HttpError(403, 'Нет доступа к этому аккаунту', 'FORBIDDEN')
  }
  return { ref, data }
}
