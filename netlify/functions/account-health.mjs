// POST /api/account-health  { accountId } -> здоровье аккаунта для дашборда (этап 7).
// Возвращает статус токена, суточный лимит публикаций Meta и доступность Instagram.
// Требует авторизации и владения аккаунтом.
import { requireOwnedAccount, requireUser } from './_lib/auth.mjs'
import { readToken } from './_lib/tokens.mjs'
import { getProfile, getPublishingLimit } from './_lib/instagram.mjs'
import { fail, HttpError, json } from './_lib/http.mjs'

export default async (req) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Метод не поддерживается', 'METHOD')
    const user = await requireUser(req)
    const body = await req.json().catch(() => ({}))
    const { data: account } = await requireOwnedAccount(user.uid, body.accountId)

    if (account.connectionStatus !== 'connected' || !account.instagramBusinessId) {
      return json({ ok: true, connected: false, connectionStatus: account.connectionStatus ?? 'disconnected' })
    }

    let token
    try {
      token = (await readToken(body.accountId)).token
    } catch {
      return json({ ok: true, connected: false, connectionStatus: 'error', tokenError: true })
    }

    // Профиль подтверждает валидность токена, лимит — остаток суточной квоты публикаций.
    let profile = null
    let igReachable = true
    try {
      profile = await getProfile(token)
    } catch (err) {
      igReachable = false
      profile = { error: err.message }
    }
    const quota = igReachable ? await getPublishingLimit(account.instagramBusinessId, token) : null

    return json({
      ok: true,
      connected: true,
      igReachable,
      username: account.instagramUsername ?? profile?.username ?? null,
      igAccountType: account.igAccountType ?? profile?.account_type ?? null,
      tokenExpiresAt: account.tokenExpiresAt ?? null,
      followersCount: profile?.followers_count ?? null,
      mediaCount: profile?.media_count ?? null,
      quota, // { used, total } | null
      checkedAt: Date.now(),
    })
  } catch (err) {
    return fail(err)
  }
}
