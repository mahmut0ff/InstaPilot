// Хранение и чтение зашифрованных токенов Instagram.
// Секрет (зашифрованный токен) лежит ТОЛЬКО в accounts/{id}/private/credentials —
// клиентские security rules закрывают эту подколлекцию полностью.
// Несекретные метаданные (срок, username) дублируются в документ аккаунта для UI.
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin.mjs'
import { decrypt, encrypt } from './crypto.mjs'
import { HttpError } from './http.mjs'

const credRef = (accountId) => adminDb.collection('accounts').doc(accountId).collection('private').doc('credentials')

const DEFAULT_TOKEN_TTL_S = 60 * 24 * 60 * 60 // Instagram long-lived token ~60 дней

// Устойчиво вычисляет момент протухания токена. Если Meta не прислала корректный
// expires_in, подставляем документированные ~60 дней, а НЕ «сейчас» — иначе cron
// на следующем прогоне ложно пометит только что обновлённый валидный токен как expired.
function expiryFrom(now, expiresIn) {
  const secs = Number(expiresIn)
  if (Number.isFinite(secs) && secs > 0) return now + secs * 1000
  console.warn('Instagram не прислал корректный expires_in — подставляю срок 60 дней')
  return now + DEFAULT_TOKEN_TTL_S * 1000
}

// Сохраняет долгоживущий токен и обновляет документ аккаунта. profile — ответ getProfile.
export async function saveConnection(accountRef, { longLivedToken, expiresIn, profile, scopeStr }) {
  const now = Date.now()
  const tokenExpiresAt = expiryFrom(now, expiresIn)
  const igUserId = String(profile.user_id ?? profile.id)

  await credRef(accountRef.id).set({
    ...encrypt(longLivedToken),
    igUserId,
    scopes: scopeStr,
    tokenIssuedAt: now,
    tokenExpiresAt,
    updatedAt: FieldValue.serverTimestamp(),
  })

  await accountRef.set(
    {
      connectionStatus: 'connected',
      instagramBusinessId: igUserId,
      instagramUsername: profile.username ?? null,
      igAccountType: profile.account_type ?? null,
      igProfilePicture: profile.profile_picture_url ?? null,
      tokenExpiresAt,
      connectedAt: FieldValue.serverTimestamp(),
      lastConnectionError: FieldValue.delete(),
    },
    { merge: true }
  )

  return { igUserId, tokenExpiresAt }
}

// Читает и расшифровывает токен. Кидает, если подключения нет.
export async function readToken(accountId) {
  const snap = await credRef(accountId).get()
  if (!snap.exists) throw new HttpError(404, 'Токен для аккаунта не найден', 'NO_TOKEN')
  const data = snap.data()
  return { token: decrypt(data), meta: data }
}

// Обновляет уже сохранённый токен (после ig_refresh_token) — без затрагивания username и т.п.
export async function updateToken(accountId, accountRef, { longLivedToken, expiresIn }) {
  const now = Date.now()
  const tokenExpiresAt = expiryFrom(now, expiresIn)
  await credRef(accountId).set(
    { ...encrypt(longLivedToken), tokenIssuedAt: now, tokenExpiresAt, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  )
  await accountRef.set({ connectionStatus: 'connected', tokenExpiresAt }, { merge: true })
  return tokenExpiresAt
}

// Удаляет токен и помечает аккаунт как отключённый.
export async function clearConnection(accountRef) {
  await credRef(accountRef.id).delete().catch(() => {})
  await accountRef.set(
    {
      connectionStatus: 'disconnected',
      instagramBusinessId: FieldValue.delete(),
      instagramUsername: FieldValue.delete(),
      igAccountType: FieldValue.delete(),
      igProfilePicture: FieldValue.delete(),
      tokenExpiresAt: FieldValue.delete(),
      connectedAt: FieldValue.delete(),
    },
    { merge: true }
  )
}
