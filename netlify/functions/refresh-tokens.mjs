// Netlify Scheduled Function — раз в сутки продлевает долгоживущие токены Instagram.
// Долгоживущий токен живёт ~60 дней; продлить можно, если ему уже >24ч и он не истёк.
// Обновляем заранее (за REFRESH_WINDOW дней до конца), протухшие помечаем как 'expired'.
import { adminDb } from './_lib/firebaseAdmin.mjs'
import { FieldValue } from 'firebase-admin/firestore'
import { refreshLongLivedToken } from './_lib/instagram.mjs'
import { readToken, updateToken } from './_lib/tokens.mjs'
import { sleep } from './_lib/http.mjs'

export const config = { schedule: '0 3 * * *' } // ежедневно в 03:00 UTC

const DAY = 24 * 60 * 60 * 1000
const REFRESH_WINDOW_MS = Number(process.env.TOKEN_REFRESH_WINDOW_DAYS || 15) * DAY
const MIN_TOKEN_AGE_MS = 24 * 60 * 60 * 1000 + 60 * 1000 // 24ч + запас

export default async () => {
  const now = Date.now()
  const summary = { checked: 0, refreshed: 0, expired: 0, skipped: 0, failed: 0 }

  const snap = await adminDb.collection('accounts').where('connectionStatus', '==', 'connected').get()

  for (const doc of snap.docs) {
    summary.checked++
    const accountRef = doc.ref
    try {
      const { token, meta } = await readToken(doc.id)
      const expiresAt = meta.tokenExpiresAt ?? 0
      const issuedAt = meta.tokenIssuedAt ?? 0

      // Уже истёк — продлить нельзя, нужен повторный OAuth.
      if (expiresAt && now >= expiresAt) {
        await accountRef.set(
          { connectionStatus: 'expired', lastConnectionError: 'Токен истёк, требуется переподключение' },
          { merge: true }
        )
        summary.expired++
        continue
      }

      const tooYoung = issuedAt && now - issuedAt < MIN_TOKEN_AGE_MS
      const notDueYet = expiresAt && expiresAt - now > REFRESH_WINDOW_MS
      if (tooYoung || notDueYet) {
        summary.skipped++
        continue
      }

      const fresh = await refreshLongLivedToken(token)
      if (!fresh.access_token) throw new Error('refresh не вернул access_token')
      await updateToken(doc.id, accountRef, {
        longLivedToken: fresh.access_token,
        expiresIn: fresh.expires_in,
      })
      summary.refreshed++
    } catch (err) {
      summary.failed++
      console.error(`refresh failed for account ${doc.id}:`, err.message)
      await accountRef
        .set({ lastConnectionError: `Не удалось обновить токен: ${err.message}`, lastRefreshAttempt: FieldValue.serverTimestamp() }, { merge: true })
        .catch(() => {})
    }
    await sleep(400) // бережём rate limits Meta между аккаунтами
  }

  console.log('refresh-tokens summary:', summary)
  return new Response(JSON.stringify(summary), {
    headers: { 'content-type': 'application/json' },
  })
}
