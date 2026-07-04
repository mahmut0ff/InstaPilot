// POST /api/connect-instagram
//   { accountId }                  -> { authUrl }   начать OAuth-подключение
//   { accountId, action:'disconnect' } -> { ok }    отвязать Instagram
//
// Требует Firebase ID token (Authorization: Bearer <token>) и владение аккаунтом.
import crypto from 'node:crypto'
import { requireOwnedAccount, requireUser } from './_lib/auth.mjs'
import { signState } from './_lib/crypto.mjs'
import { buildAuthUrl } from './_lib/instagram.mjs'
import { clearConnection } from './_lib/tokens.mjs'
import { fail, HttpError, json } from './_lib/http.mjs'

const STATE_TTL_MS = 10 * 60 * 1000 // окно на прохождение OAuth — 10 минут

export default async (req) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Метод не поддерживается', 'METHOD')

    const user = await requireUser(req)
    const body = await req.json().catch(() => ({}))
    const { ref } = await requireOwnedAccount(user.uid, body.accountId)

    if (body.action === 'disconnect') {
      await clearConnection(ref)
      return json({ ok: true })
    }

    // Подписанный state: переносит uid+accountId через redirect и защищает от CSRF.
    const state = signState({
      uid: user.uid,
      accountId: ref.id,
      nonce: crypto.randomBytes(12).toString('base64url'),
      exp: Date.now() + STATE_TTL_MS,
    })

    return json({ ok: true, authUrl: buildAuthUrl(state) })
  } catch (err) {
    return fail(err)
  }
}
